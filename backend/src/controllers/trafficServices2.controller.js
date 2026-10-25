/**
 * Five more Traffic services, added alongside the original five (now in traffic.controller.js
 * with required photo/biometric capture — see migration 042):
 *
 *   - Driving Theory Test / Practical Driving Test (driving_test_bookings) — a bespoke booking
 *     workflow (Requested -> Scheduled -> Completed, or Cancelled/Rejected), not a reuse of the
 *     licence-issuing pipeline, because a test booking's lifecycle is genuinely different.
 *
 *     Migration 067 rebuilt this around the real sequence a learner driver follows: a citizen
 *     books ONLY the theory test, which is auto-scheduled immediately (no officer "schedule"
 *     step needed). An officer sets that specific sitting's questions, then records a Pass/Fail
 *     result (with optional marks). A Pass auto-creates the Practical booking — scheduled
 *     exactly 3 days after the theory sitting, per the requirement that the practical cannot
 *     happen any sooner — with no citizen action at all. An officer enters the practical test's
 *     location (there is no "test centre" concept in the offices table, so this is a free-text
 *     venue) and then its result. A Practical Pass automatically produces a Learner's Permit
 *     (2-year validity) in traffic_records, reusing the citizen's National ID photo and
 *     fingerprints rather than capturing anything fresh — see autoGenerateLearnerPermit() below.
 *     Previously a Learner Permit was something a citizen applied for directly (no exam at all),
 *     and holding one was a precondition just to BOOK the theory test — backwards from the real
 *     process the user described, so that direct-apply path is gone; see
 *     driving_licence.controller.js and frontend/src/pages/traffic/LearnerPermit.jsx, which is
 *     now a read-only status page instead of an application form.
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

/** POST /traffic/test-bookings (citizen) — only the Theory test can be requested directly; the
 *  Practical test is always auto-created by recordTestResult() below once Theory is passed, so
 *  there is nothing for a citizen to book there. Auto-schedules immediately (status goes
 *  straight to 'Scheduled', confirmed_date = the citizen's requested date) — "automatically
 *  schedule that test" — rather than sitting in 'Requested' awaiting an officer. */
async function requestTestBooking(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to book a driving test.' });
    const { testType, requestedDate, officeId } = req.body;
    if (testType !== 'Theory') {
      return res.status(400).json({ error: 'Only the theory test can be booked directly — the practical test is scheduled automatically once you pass your theory test.' });
    }
    if (!requestedDate) return res.status(400).json({ error: 'requestedDate is required.' });
    const todayStr = new Date().toISOString().slice(0, 10);
    if (requestedDate < todayStr) return res.status(400).json({ error: 'requestedDate must be today or a future date.' });
    if (!officeId) return res.status(400).json({ error: 'officeId is required — choose your preferred test centre.' });

    const { rows: inProgress } = await db.query(
      `SELECT 1 FROM driving_test_bookings WHERE citizen_id = $1 AND test_type = 'Theory' AND status IN ('Requested', 'Scheduled')`,
      [req.user.citizenId]
    );
    if (inProgress.length > 0) return res.status(409).json({ error: 'You already have a theory test booked.' });

    const bookingReference = generateReference('DTB');
    const { rows } = await db.query(
      `INSERT INTO driving_test_bookings (citizen_id, booking_reference, test_type, requested_date, confirmed_date, office_id, status)
       VALUES ($1,$2,'Theory',$3,$3,$4,'Scheduled') RETURNING *`,
      [req.user.citizenId, bookingReference, requestedDate, officeId]
    );
    const booking = rows[0];
    await indexApplication(db, {
      citizenId: req.user.citizenId, departmentKey: 'traffic', serviceType: 'Theory Driving Test',
      referenceNumber: bookingReference, sourceTable: 'driving_test_bookings', sourceId: booking.driving_test_booking_id, status: 'Scheduled',
    });
    await createNotification({ userId: req.user.userId, title: 'Theory test scheduled', message: `Reference ${bookingReference}, on ${requestedDate}.`, type: 'Application Submitted' });
    res.status(201).json({ booking });
  } catch (err) { next(err); }
}

/** POST /traffic/test-bookings/:id/questions (officer) — the questions set for one specific
 *  Theory sitting; must be set before a result can be recorded for it. A lightweight per-sitting
 *  list (JSON array of strings), not a reusable bank with auto-grading — nothing asked for that. */
async function setTheoryQuestions(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const { questions } = req.body;
    if (!Array.isArray(questions) || questions.length === 0 || questions.some((q) => !q || !String(q).trim())) {
      return res.status(400).json({ error: 'questions must be a non-empty list of non-empty question strings.' });
    }
    const { rows } = await db.query(
      `UPDATE driving_test_bookings SET theory_questions = $1::jsonb, questions_set_by_user_id = $2, questions_set_at = NOW(), updated_at = NOW()
       WHERE driving_test_booking_id = $3 AND test_type = 'Theory' AND status = 'Scheduled' RETURNING *`,
      [JSON.stringify(questions.map((q) => String(q).trim())), req.user.userId, req.params.id]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Cannot set questions for this booking in its current state.' });
    res.json({ booking: rows[0] });
  } catch (err) { next(err); }
}

/** POST /traffic/test-bookings/:id/set-location (officer) — "the location where practical test
 *  will take place must be entered by officer". Free-text venue, since offices has no notion of
 *  a dedicated test centre distinct from any other branch. recordTestResult() below refuses to
 *  mark a Practical booking's result until this has been set. */
async function setTestLocation(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const { testLocation } = req.body;
    if (!testLocation || !String(testLocation).trim()) return res.status(400).json({ error: 'testLocation is required.' });
    const { rows } = await db.query(
      `UPDATE driving_test_bookings SET test_location = $1, updated_at = NOW()
       WHERE driving_test_booking_id = $2 AND test_type = 'Practical' AND status = 'Scheduled' RETURNING *`,
      [String(testLocation).trim(), req.params.id]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Cannot set the location for this booking in its current state.' });
    res.json({ booking: rows[0] });
  } catch (err) { next(err); }
}

/** Reuses the citizen's own National ID photo/fingerprints (migrations 007/034/036) rather than
 *  capturing anything fresh — "the system must reuse biomatrix that captured during id
 *  application ... for license and learners". Best-effort: a citizen whose National ID card has
 *  no stored photo/biometrics still gets their Learner's Permit, just without those references
 *  filled in, exactly the same resilience already used for passports with no stored ID photo. */
async function autoGenerateLearnerPermit(client, citizenId, practicalBookingId) {
  const { rows: idRows } = await client.query(
    `SELECT photo_reference, biometric_reference_left, biometric_reference_right
     FROM national_id_cards WHERE citizen_id = $1 AND production_status = 'Collected' ORDER BY approval_date DESC LIMIT 1`,
    [citizenId]
  );
  const idCapture = idRows[0] || {};
  const referenceNumber = generateReference('TR');
  const licenceNumber = genNumber('LP');
  const { rows } = await client.query(
    `INSERT INTO traffic_records
        (citizen_id, application_reference, service_type, status, licence_number, issue_date, expiry_date,
         photo_reference, biometric_reference_left, biometric_reference_right, photo_source, source_test_booking_id)
     VALUES ($1,$2,'Learner Permit','Approved',$3,CURRENT_DATE,CURRENT_DATE + INTERVAL '2 years',$4,$5,$6,'id',$7)
     RETURNING *`,
    [citizenId, referenceNumber, licenceNumber, idCapture.photo_reference || null, idCapture.biometric_reference_left || null, idCapture.biometric_reference_right || null, practicalBookingId]
  );
  const permit = rows[0];
  await indexApplication(client, {
    citizenId, departmentKey: 'traffic', serviceType: 'Learner Permit', referenceNumber,
    sourceTable: 'traffic_records', sourceId: permit.traffic_record_id, status: 'Approved',
  });
  return permit;
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

/** POST /traffic/test-bookings/:id/record-result body:{result, marks?} (officer) — marks (0-100)
 *  is the officer's recorded score, kept alongside the existing Pass/Fail result which stays the
 *  authoritative gate. Refuses to run on a Theory booking with no questions set, or a Practical
 *  booking with no location set — those are now required steps, not optional ones. A Theory Pass
 *  auto-creates the Practical booking (confirmed 3 days later); a Practical Pass auto-generates
 *  the Learner's Permit. All in the same transaction as the result itself, so the officer's one
 *  click produces the result and whatever follows from it together. */
async function recordTestResult(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const { result, marks } = req.body;
    if (!['Passed', 'Failed'].includes(result)) return res.status(400).json({ error: "result must be 'Passed' or 'Failed'." });
    let marksValue = null;
    if (marks !== undefined && marks !== null && marks !== '') {
      marksValue = Number(marks);
      if (Number.isNaN(marksValue) || marksValue < 0 || marksValue > 100) {
        return res.status(400).json({ error: 'marks must be a number between 0 and 100.' });
      }
    }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows: existingRows } = await client.query('SELECT * FROM driving_test_bookings WHERE driving_test_booking_id = $1 FOR UPDATE', [req.params.id]);
      if (existingRows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found.' }); }
      const existing = existingRows[0];
      if (existing.status !== 'Scheduled') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Cannot record a result for this booking in its current state.' });
      }
      if (existing.test_type === 'Theory' && !existing.theory_questions) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Set the theory test questions before recording a result.' });
      }
      if (existing.test_type === 'Practical' && !existing.test_location) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Enter the practical test location before recording a result.' });
      }

      const { rows } = await client.query(
        `UPDATE driving_test_bookings SET status = 'Completed', result = $1, marks = $2, updated_at = NOW()
         WHERE driving_test_booking_id = $3 RETURNING *`,
        [result, marksValue, req.params.id]
      );
      const booking = rows[0];
      await syncApplicationStatus(client, { sourceTable: 'driving_test_bookings', sourceId: booking.driving_test_booking_id, status: 'Completed', completed: true });

      let autoScheduledPractical = null;
      let generatedPermit = null;
      if (result === 'Passed' && booking.test_type === 'Theory') {
        const bookingReference = generateReference('DTB');
        const { rows: practicalRows } = await client.query(
          // requested_date has no real citizen-chosen value here (nothing was requested — this
          // booking is entirely auto-created), but the column is NOT NULL (migration 043), so it
          // is set to the same auto-computed date as confirmed_date rather than left null.
          `INSERT INTO driving_test_bookings (citizen_id, booking_reference, test_type, office_id, requested_date, confirmed_date, status, theory_booking_id)
           VALUES ($1,$2,'Practical',$3, (DATE($4) + INTERVAL '3 days'), (DATE($4) + INTERVAL '3 days'), 'Scheduled', $5) RETURNING *`,
          [booking.citizen_id, bookingReference, booking.office_id, booking.confirmed_date, booking.driving_test_booking_id]
        );
        autoScheduledPractical = practicalRows[0];
        await indexApplication(client, {
          citizenId: booking.citizen_id, departmentKey: 'traffic', serviceType: 'Practical Driving Test',
          referenceNumber: bookingReference, sourceTable: 'driving_test_bookings', sourceId: autoScheduledPractical.driving_test_booking_id, status: 'Scheduled',
        });
      }
      if (result === 'Passed' && booking.test_type === 'Practical') {
        generatedPermit = await autoGenerateLearnerPermit(client, booking.citizen_id, booking.driving_test_booking_id);
      }

      await client.query('COMMIT');

      const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [booking.citizen_id])).rows[0];
      if (userRow) {
        await createNotification({ userId: userRow.user_id, title: `${booking.test_type} test: ${result}`, message: `Reference ${booking.booking_reference}.`, type: result === 'Passed' ? 'Approval' : 'Rejection' });
        if (autoScheduledPractical) {
          await createNotification({
            userId: userRow.user_id, title: 'Practical driving test scheduled',
            message: `Reference ${autoScheduledPractical.booking_reference}, on ${String(autoScheduledPractical.confirmed_date).slice(0, 10)}.`, type: 'Status Change',
          });
        }
        if (generatedPermit) {
          await createNotification({
            userId: userRow.user_id, title: "Learner's Permit issued",
            message: `${generatedPermit.licence_number}, valid until ${String(generatedPermit.expiry_date).slice(0, 10)}.`, type: 'Approval',
          });
        }
      }
      res.json({ booking, autoScheduledPractical, generatedPermit });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
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
  requestTestBooking, listTestBookings, getTestBooking, scheduleTestBooking, setTheoryQuestions, setTestLocation,
  recordTestResult, cancelTestBooking, rejectTestBooking,
  vehicleInspectionsController,
  transportPermitsController,
  createDrivingInstructor, listDrivingInstructors, getDrivingInstructor, updateDrivingInstructorStatus,
};
