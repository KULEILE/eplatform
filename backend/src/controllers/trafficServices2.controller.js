/**
 * Five more Traffic services, added alongside the original five (now in traffic.controller.js
 * with required photo/biometric capture — see migration 042):
 *
 *   - Driving Theory Test / Practical Driving Test (driving_test_bookings) — a bespoke booking
 *     workflow (Requested -> Scheduled -> Completed, or Cancelled/Rejected), not a reuse of the
 *     licence-issuing pipeline, because a test booking's lifecycle is genuinely different.
 *     Eligibility is enforced here, not just suggested in the UI: a Theory test requires an
 *     Approved Learner Permit already on record, and a Practical test additionally requires a
 *     Passed Theory test.
 *   - Roadworthiness Test & Certificate of Fitness (vehicle_inspections) — reuses
 *     makeDepartmentController, the same linear "apply -> review -> approve (assigns a number)"
 *     shape as traffic_records. Requires an Approved vehicle registration for the given
 *     vehicle_registration_number.
 *   - Transport Operating Permit, new or renewal (transport_operating_permits) — also reuses
 *     makeDepartmentController. Requires a valid, unexpired Certificate of Fitness for the
 *     vehicle: a commercial transport permit cannot be granted for a vehicle not confirmed
 *     roadworthy.
 *   - Driving Instructor & Examiner Certification (driving_instructor_registrations) — an
 *     admin-only registry, the same shape as marriage_officer_registrations in Home Affairs:
 *     there is no citizen applicant, a Traffic officer or system administrator manages it
 *     directly.
 */
const db = require('../config/db');
const { generateReference } = require('../utils/referenceGenerator');
const { indexApplication, syncApplicationStatus, getDepartmentId } = require('../utils/lookup');
const { createNotification } = require('../utils/notify');
const { recordAudit } = require('../utils/audit');
const { makeDepartmentController } = require('../utils/simpleDepartmentController');

const TRAFFIC_OFFICER_ROLES = ['traffic_officer', 'system_administrator'];
const isOfficer = (req) => TRAFFIC_OFFICER_ROLES.includes(req.user.roleKey);

function genNumber(prefix) {
  return `${prefix}-${String(Math.floor(100000 + Math.random() * 900000))}`;
}

async function citizenHasApprovedTrafficRecord(citizenId, column, value) {
  const { rows } = await db.query(
    `SELECT 1 FROM traffic_records WHERE citizen_id = $1 AND ${column} = $2
     AND status IN ('Approved', 'Ready for Collection', 'Collected')`,
    [citizenId, value]
  );
  return rows.length > 0;
}

// ============================================================================================
// DRIVING THEORY TEST / PRACTICAL DRIVING TEST
// ============================================================================================

async function requestTestBooking(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to book a driving test.' });
    const { testType, requestedDate, officeId } = req.body;
    if (!['Theory', 'Practical'].includes(testType)) return res.status(400).json({ error: "testType must be 'Theory' or 'Practical'." });
    if (!requestedDate) return res.status(400).json({ error: 'requestedDate is required.' });
    if (!officeId) return res.status(400).json({ error: 'officeId is required — choose your preferred test centre.' });

    if (!(await citizenHasApprovedTrafficRecord(req.user.citizenId, 'service_type', 'Learner Permit'))) {
      return res.status(409).json({ error: 'An approved Learner Permit is required before booking a driving test.' });
    }
    if (testType === 'Practical') {
      const { rows } = await db.query(
        `SELECT 1 FROM driving_test_bookings WHERE citizen_id = $1 AND test_type = 'Theory' AND result = 'Passed'`,
        [req.user.citizenId]
      );
      if (rows.length === 0) return res.status(409).json({ error: 'You must pass the theory test before booking the practical test.' });
    }

    const bookingReference = generateReference('DTB');
    const { rows } = await db.query(
      `INSERT INTO driving_test_bookings (citizen_id, booking_reference, test_type, requested_date, office_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.citizenId, bookingReference, testType, requestedDate, officeId]
    );
    const booking = rows[0];
    await indexApplication(db, {
      citizenId: req.user.citizenId, departmentKey: 'traffic', serviceType: `${testType} Driving Test`,
      referenceNumber: bookingReference, sourceTable: 'driving_test_bookings', sourceId: booking.driving_test_booking_id, status: 'Requested',
    });
    await createNotification({ userId: req.user.userId, title: `${testType} test booking requested`, message: `Reference ${bookingReference}.`, type: 'Application Submitted' });
    res.status(201).json({ booking });
  } catch (err) { next(err); }
}

async function listTestBookings(req, res, next) {
  try {
    if (isOfficer(req)) {
      const { rows } = await db.query(
        `SELECT b.*, c.first_name, c.last_name FROM driving_test_bookings b
         JOIN citizens c ON c.citizen_id = b.citizen_id ORDER BY b.requested_at DESC`
      );
      return res.json({ bookings: rows });
    }
    if (!req.user.citizenId) return res.json({ bookings: [] });
    const { rows } = await db.query(`SELECT * FROM driving_test_bookings WHERE citizen_id = $1 ORDER BY requested_at DESC`, [req.user.citizenId]);
    res.json({ bookings: rows });
  } catch (err) { next(err); }
}

async function getTestBooking(req, res, next) {
  try {
    const { rows } = await db.query(`SELECT * FROM driving_test_bookings WHERE driving_test_booking_id = $1`, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Booking not found.' });
    const booking = rows[0];
    if (!isOfficer(req) && booking.citizen_id !== req.user.citizenId) return res.status(403).json({ error: 'Not your booking.' });
    res.json({ booking });
  } catch (err) { next(err); }
}

async function scheduleTestBooking(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const { confirmedDate } = req.body;
    if (!confirmedDate) return res.status(400).json({ error: 'confirmedDate is required.' });
    const { rows } = await db.query(
      `UPDATE driving_test_bookings SET status = 'Scheduled', confirmed_date = $1, updated_at = NOW()
       WHERE driving_test_booking_id = $2 AND status = 'Requested' RETURNING *`,
      [confirmedDate, req.params.id]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Cannot schedule this booking in its current state.' });
    await syncApplicationStatus(db, { sourceTable: 'driving_test_bookings', sourceId: rows[0].driving_test_booking_id, status: 'Scheduled' });
    res.json({ booking: rows[0] });
  } catch (err) { next(err); }
}

async function recordTestResult(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const { result } = req.body;
    if (!['Passed', 'Failed'].includes(result)) return res.status(400).json({ error: "result must be 'Passed' or 'Failed'." });
    const { rows } = await db.query(
      `UPDATE driving_test_bookings SET status = 'Completed', result = $1, updated_at = NOW()
       WHERE driving_test_booking_id = $2 AND status = 'Scheduled' RETURNING *`,
      [result, req.params.id]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Cannot record a result for this booking in its current state.' });
    await syncApplicationStatus(db, { sourceTable: 'driving_test_bookings', sourceId: rows[0].driving_test_booking_id, status: 'Completed', completed: true });
    const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [rows[0].citizen_id])).rows[0];
    if (userRow) {
      await createNotification({ userId: userRow.user_id, title: `${rows[0].test_type} test: ${result}`, message: `Reference ${rows[0].booking_reference}.`, type: result === 'Passed' ? 'Approval' : 'Rejection' });
    }
    res.json({ booking: rows[0] });
  } catch (err) { next(err); }
}

async function cancelTestBooking(req, res, next) {
  try {
    const { rows: existing } = await db.query(`SELECT * FROM driving_test_bookings WHERE driving_test_booking_id = $1`, [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Booking not found.' });
    if (!isOfficer(req) && existing[0].citizen_id !== req.user.citizenId) return res.status(403).json({ error: 'Not your booking.' });
    const { rows } = await db.query(
      `UPDATE driving_test_bookings SET status = 'Cancelled', updated_at = NOW()
       WHERE driving_test_booking_id = $1 AND status IN ('Requested', 'Scheduled') RETURNING *`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Cannot cancel this booking in its current state.' });
    await syncApplicationStatus(db, { sourceTable: 'driving_test_bookings', sourceId: rows[0].driving_test_booking_id, status: 'Cancelled', completed: true });
    res.json({ booking: rows[0] });
  } catch (err) { next(err); }
}

async function rejectTestBooking(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'A reason is required.' });
    const { rows } = await db.query(
      `UPDATE driving_test_bookings SET status = 'Rejected', rejection_reason = $1, updated_at = NOW()
       WHERE driving_test_booking_id = $2 AND status IN ('Requested', 'Scheduled') RETURNING *`,
      [reason, req.params.id]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Cannot reject this booking in its current state.' });
    await syncApplicationStatus(db, { sourceTable: 'driving_test_bookings', sourceId: rows[0].driving_test_booking_id, status: 'Rejected', completed: true });
    const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [rows[0].citizen_id])).rows[0];
    if (userRow) await createNotification({ userId: userRow.user_id, title: 'Test booking rejected', message: reason, type: 'Rejection' });
    res.json({ booking: rows[0] });
  } catch (err) { next(err); }
}

// ============================================================================================
// ROADWORTHINESS TEST & CERTIFICATE OF FITNESS (COF)
// ============================================================================================

const vehicleInspectionsController = makeDepartmentController({
  table: 'vehicle_inspections',
  idColumn: 'vehicle_inspection_id',
  deptKey: 'traffic',
  officerRoleKey: 'traffic_officer',
  refPrefix: 'COF',
  serviceTypes: ['Roadworthiness Test & Certificate of Fitness'],
  finalStatuses: ['Rejected', 'Approved'], // Approved IS the end state here — no physical collection step
  beforeApply: async (req) => {
    if (!req.body.vehicleRegistrationNumber) return { error: 'vehicleRegistrationNumber is required.' };
    if (!req.body.officeId) return { error: 'officeId is required — choose an inspection centre.' };
    if (!(await citizenHasApprovedTrafficRecord(req.user.citizenId, 'vehicle_registration_number', req.body.vehicleRegistrationNumber))) {
      return { error: 'No registered vehicle with that registration number was found on your record.' };
    }
    return null;
  },
  extraInsertFields: [
    { column: 'vehicle_registration_number', fromBody: 'vehicleRegistrationNumber' },
    { column: 'office_id', fromBody: 'officeId' },
  ],
  statusFlow: {
    'start-review': { from: 'Submitted', to: 'Under Review' },
    'check-documents': { from: 'Under Review', to: 'Documents Checked' },
    'process': { from: 'Documents Checked', to: 'Processing' },
    'approve': {
      from: 'Processing', to: 'Approved',
      extra: () => ({
        setSql: `cof_number = $3, cof_issue_date = CURRENT_DATE, cof_expiry_date = CURRENT_DATE + INTERVAL '1 year'`,
        params: [genNumber('COF')],
      }),
    },
  },
});

// ============================================================================================
// TRANSPORT OPERATING PERMIT (new or renewal)
// ============================================================================================

const transportPermitsController = makeDepartmentController({
  table: 'transport_operating_permits',
  idColumn: 'transport_operating_permit_id',
  deptKey: 'traffic',
  officerRoleKey: 'traffic_officer',
  refPrefix: 'TOP',
  serviceTypes: ['New', 'Renewal'],
  finalStatuses: ['Rejected', 'Approved'],
  beforeApply: async (req) => {
    const b = req.body;
    if (!b.vehicleRegistrationNumber) return { error: 'vehicleRegistrationNumber is required.' };
    if (!['A', 'B', 'C', 'D', 'E', 'F'].includes(b.permitCategory)) return { error: 'permitCategory must be one of A, B, C, D, E, F.' };
    if (!b.operatingRouteOrArea) return { error: 'operatingRouteOrArea is required — the operating area must be known before a permit can be granted.' };
    if (b.serviceType === 'Renewal' && !b.previousPermitNumber) return { error: 'previousPermitNumber is required for a renewal.' };
    const { rows } = await db.query(
      `SELECT 1 FROM vehicle_inspections WHERE citizen_id = $1 AND vehicle_registration_number = $2
       AND status = 'Approved' AND cof_expiry_date >= CURRENT_DATE`,
      [req.user.citizenId, b.vehicleRegistrationNumber]
    );
    if (rows.length === 0) return { error: 'A valid, unexpired Certificate of Fitness for this vehicle is required before a transport operating permit can be issued.' };
    return null;
  },
  extraInsertFields: [
    { column: 'vehicle_registration_number', fromBody: 'vehicleRegistrationNumber' },
    { column: 'permit_category', fromBody: 'permitCategory' },
    { column: 'operating_route_or_area', fromBody: 'operatingRouteOrArea' },
    { column: 'previous_permit_number', fromBody: 'previousPermitNumber' },
  ],
  statusFlow: {
    'start-review': { from: 'Submitted', to: 'Under Review' },
    'check-documents': { from: 'Under Review', to: 'Documents Checked' },
    'process': { from: 'Documents Checked', to: 'Processing' },
    'approve': {
      from: 'Processing', to: 'Approved',
      extra: () => ({
        setSql: `permit_number = $3, valid_from = CURRENT_DATE, valid_until = CURRENT_DATE + INTERVAL '1 year'`,
        params: [genNumber('TOP')],
      }),
    },
  },
});

// ============================================================================================
// DRIVING INSTRUCTOR & EXAMINER CERTIFICATION — admin registry, no citizen applicant
// ============================================================================================

async function createDrivingInstructor(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const { fullName, certificationType, drivingSchoolOrAuthority, districtId, notes } = req.body;
    if (!fullName || !certificationType) return res.status(400).json({ error: 'fullName and certificationType are required.' });
    if (!['Instructor', 'Examiner'].includes(certificationType)) return res.status(400).json({ error: "certificationType must be 'Instructor' or 'Examiner'." });
    const licenceOrCertificateNumber = generateReference('DIC');
    const { rows } = await db.query(
      `INSERT INTO driving_instructor_registrations (full_name, certification_type, driving_school_or_authority, district_id, licence_or_certificate_number, notes, registered_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [fullName, certificationType, drivingSchoolOrAuthority || null, districtId || null, licenceOrCertificateNumber, notes || null, req.user.userId]
    );
    await recordAudit({ userId: req.user.userId, departmentId: await getDepartmentId('traffic'), action: 'DRIVING_INSTRUCTOR_REGISTERED', targetType: 'driving_instructor_registration', targetId: rows[0].driving_instructor_registration_id });
    res.status(201).json({ drivingInstructor: rows[0] });
  } catch (err) { next(err); }
}

async function listDrivingInstructors(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const { status, districtId } = req.query;
    const { rows } = await db.query(
      `SELECT i.*, d.name AS district_name FROM driving_instructor_registrations i
       LEFT JOIN districts d ON d.district_id = i.district_id
       WHERE ($1::text IS NULL OR i.status = $1) AND ($2::int IS NULL OR i.district_id = $2)
       ORDER BY i.registered_at DESC`,
      [status || null, districtId || null]
    );
    res.json({ drivingInstructors: rows });
  } catch (err) { next(err); }
}

async function getDrivingInstructor(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const { rows } = await db.query(
      `SELECT i.*, d.name AS district_name FROM driving_instructor_registrations i
       LEFT JOIN districts d ON d.district_id = i.district_id WHERE i.driving_instructor_registration_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Driving instructor registration not found.' });
    res.json({ drivingInstructor: rows[0] });
  } catch (err) { next(err); }
}

async function updateDrivingInstructorStatus(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const { status, notes } = req.body;
    if (!['Registered', 'Suspended', 'Revoked'].includes(status)) return res.status(400).json({ error: "status must be 'Registered', 'Suspended' or 'Revoked'." });
    const { rows } = await db.query(
      `UPDATE driving_instructor_registrations SET status = $1, notes = COALESCE($2, notes),
          status_changed_by_user_id = $3, status_changed_at = NOW(), updated_at = NOW()
       WHERE driving_instructor_registration_id = $4 RETURNING *`,
      [status, notes || null, req.user.userId, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Driving instructor registration not found.' });
    await recordAudit({ userId: req.user.userId, departmentId: await getDepartmentId('traffic'), action: `DRIVING_INSTRUCTOR_${status.toUpperCase()}`, targetType: 'driving_instructor_registration', targetId: Number(req.params.id) });
    res.json({ drivingInstructor: rows[0] });
  } catch (err) { next(err); }
}

module.exports = {
  requestTestBooking, listTestBookings, getTestBooking, scheduleTestBooking, recordTestResult, cancelTestBooking, rejectTestBooking,
  vehicleInspectionsController,
  transportPermitsController,
  createDrivingInstructor, listDrivingInstructors, getDrivingInstructor, updateDrivingInstructorStatus,
};
