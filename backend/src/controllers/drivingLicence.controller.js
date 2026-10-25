const db = require('../config/db');
const { generateReference } = require('../utils/referenceGenerator');
const { indexApplication, syncApplicationStatus, getDepartmentId } = require('../utils/lookup');
const { createNotification } = require('../utils/notify');
const { recordAudit } = require('../utils/audit');
const { makeDepartmentController } = require('../utils/simpleDepartmentController');

// ============================================================================================
// DRIVING LICENCE — Application / Renewal / Replacement, consolidated onto one bespoke
// controller (migration 067), the same shape as passport.controller.js:
//
//   1. A driving licence identifies a specific person, so its photo/fingerprints are resolved
//      the same way National ID's are for a passport: reuse the citizen's own collected National
//      ID capture, or capture fresh ones — never trust a client-sent "reuse" claim, always
//      resolve it server-side from national_id_cards.
//   2. A FIRST licence ('New') requires a valid, unexpired Learner's Permit — which is no longer
//      something a citizen can apply for directly; see driving_test_bookings/trafficServices2.
//      controller.js. That permit is displayed throughout the application and must be physically
//      surrendered at collection (surrender_status, same single-confirm pattern as passport
//      batch 15 — the officer's one 'collect' click both surrenders the permit and collects the
//      new licence).
//   3. Renewal is blocked while the current licence hasn't actually expired — UNLESS the citizen
//      declares it damaged and provides proof, in which case early renewal is allowed.
//   4. Replacement (Lost/Stolen) carries the same mandatory 3-month wait already used for
//      passport and National ID replacement.
//
// Application/Renewal/Replacement are one service with an applicationType the citizen chooses —
// not three separate pages/routes — removing the duplicate-service pattern the previous
// DrivingLicenceApply/Renew/Replace.jsx pages had.
// ============================================================================================

const REPLACEMENT_WAIT_MONTHS = 3;
const LICENCE_VALID_YEARS = 5;
const SERVICE_TYPES = ['Driving Licence Application', 'Driving Licence Renewal', 'Driving Licence Replacement'];

function genNumber(prefix) {
  return `${prefix}-${String(Math.floor(100000 + Math.random() * 900000))}`;
}

/** Same date math used everywhere else in this codebase for a 3-month lost/stolen wait. */
function addMonthsUTC(date, months) {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

async function getIdCapture(citizenId) {
  const { rows } = await db.query(
    `SELECT photo_reference, biometric_reference_left, biometric_reference_right
     FROM national_id_cards WHERE citizen_id = $1 AND production_status = 'Collected' ORDER BY approval_date DESC LIMIT 1`,
    [citizenId]
  );
  return rows[0] || null;
}

async function hasCollectedNationalId(citizenId) {
  const { rows } = await db.query(
    `SELECT 1 FROM national_id_cards WHERE citizen_id = $1 AND production_status = 'Collected' LIMIT 1`,
    [citizenId]
  );
  return rows.length > 0;
}

/** Resolves photo + both-hand fingerprints from the citizen's biometricsSource choice
 *  ('id' | 'new'). 'id' is only honoured with a COMPLETE National ID capture on file (resolved
 *  server-side, never trusting client-sent references for it) — a card with some but not all
 *  three references on file falls back to requiring a fresh capture, same resilience spirit as
 *  passport.controller.js's getIdPhotoReference/hasCollectedNationalId split. */
async function resolveIdentityCapture(citizenId, source, body) {
  if (source === 'id') {
    const idCapture = await getIdCapture(citizenId);
    if (!idCapture || !idCapture.photo_reference || !idCapture.biometric_reference_left || !idCapture.biometric_reference_right) {
      return { ok: false, error: 'Your National ID record does not have a complete photo and fingerprint capture on file to reuse. Please capture new ones instead.' };
    }
    return { ok: true, photoReference: idCapture.photo_reference, biometricReferenceLeft: idCapture.biometric_reference_left, biometricReferenceRight: idCapture.biometric_reference_right };
  }
  if (!body.photoReference || !body.biometricReferenceLeft || !body.biometricReferenceRight) {
    return { ok: false, error: 'A photo and a fingerprint scan of both hands are required.' };
  }
  return { ok: true, photoReference: body.photoReference, biometricReferenceLeft: body.biometricReferenceLeft, biometricReferenceRight: body.biometricReferenceRight };
}

/** The citizen's currently valid Learner's Permit (service_type = 'Learner Permit', status
 *  'Approved' — these are produced automatically on a passed practical test and never go through
 *  any review pipeline, so 'Approved' is their terminal, fully-issued state), if any. */
async function getValidLearnerPermit(citizenId) {
  const { rows } = await db.query(
    `SELECT * FROM traffic_records WHERE citizen_id = $1 AND service_type = 'Learner Permit' AND status = 'Approved'
     ORDER BY expiry_date DESC LIMIT 1`,
    [citizenId]
  );
  const permit = rows[0];
  if (!permit) return null;
  const today = new Date().toISOString().slice(0, 10);
  return { ...permit, isExpired: !!(permit.expiry_date && String(permit.expiry_date).slice(0, 10) < today) };
}

/** The citizen's current (Collected) driving licence, across all three service types — mirrors
 *  passport.controller.js's summarizePassportSubject's "most relevant collected record" logic. */
async function getCurrentDrivingLicence(citizenId) {
  const { rows } = await db.query(
    `SELECT * FROM traffic_records WHERE citizen_id = $1 AND service_type = ANY($2::varchar[]) AND status = 'Collected'
     ORDER BY expiry_date DESC NULLS LAST, created_at DESC LIMIT 1`,
    [citizenId, SERVICE_TYPES]
  );
  const rec = rows[0];
  if (!rec) return null;
  const today = new Date().toISOString().slice(0, 10);
  return { ...rec, isExpired: !!(rec.expiry_date && String(rec.expiry_date).slice(0, 10) < today) };
}

/** GET /traffic/driving-licence/eligibility — everything DrivingLicence.jsx needs up front: the
 *  citizen's National ID/capture situation, their Learner's Permit (to display on a first
 *  application), their current licence (to decide whether renewal is blocked), and whether an
 *  application is already in progress. */
async function getEligibility(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required.' });
    const citizenId = req.user.citizenId;
    const hasId = await hasCollectedNationalId(citizenId);
    const idCapture = await getIdCapture(citizenId);
    const idCaptureAvailable = !!(idCapture && idCapture.photo_reference && idCapture.biometric_reference_left && idCapture.biometric_reference_right);
    const learnerPermit = await getValidLearnerPermit(citizenId);
    const currentLicence = await getCurrentDrivingLicence(citizenId);
    const { rows: inProgressRows } = await db.query(
      `SELECT application_reference, service_type, status FROM traffic_records
       WHERE citizen_id = $1 AND service_type = ANY($2::varchar[]) AND status NOT IN ('Rejected', 'Collected') LIMIT 1`,
      [citizenId, SERVICE_TYPES]
    );
    res.json({
      hasCollectedNationalId: hasId,
      idCaptureAvailable,
      learnerPermit: learnerPermit ? {
        trafficRecordId: learnerPermit.traffic_record_id, licenceNumber: learnerPermit.licence_number,
        issueDate: learnerPermit.issue_date, expiryDate: learnerPermit.expiry_date, isExpired: learnerPermit.isExpired,
      } : null,
      currentLicence: currentLicence ? {
        trafficRecordId: currentLicence.traffic_record_id, licenceNumber: currentLicence.licence_number, serviceType: currentLicence.service_type,
        issueDate: currentLicence.issue_date, expiryDate: currentLicence.expiry_date, isExpired: currentLicence.isExpired,
      } : null,
      hasInProgressApplication: inProgressRows.length > 0,
      inProgressApplication: inProgressRows[0] || null,
      replacementWaitMonths: REPLACEMENT_WAIT_MONTHS,
    });
  } catch (err) { next(err); }
}

/** POST /traffic/driving-licence/apply — body: { applicationType: 'New'|'Renewal'|'Replacement',
 *  preferredOfficeId, biometricsSource: 'id'|'new', photoReference?, biometricReferenceLeft?,
 *  biometricReferenceRight?, renewalDamaged?, damageProofReference?, replacementReason?,
 *  previousLicenceNumber?, reportedLostAt? }. */
async function apply(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to apply for a driving licence.' });
    const citizenId = req.user.citizenId;
    const b = req.body;
    const { applicationType, preferredOfficeId, biometricsSource } = b;
    if (!['New', 'Renewal', 'Replacement'].includes(applicationType)) {
      return res.status(400).json({ error: "applicationType must be 'New', 'Renewal', or 'Replacement'." });
    }
    if (!preferredOfficeId) return res.status(400).json({ error: 'preferredOfficeId is required — choose the branch where you will collect it.' });

    const { rows: inProgress } = await db.query(
      `SELECT 1 FROM traffic_records WHERE citizen_id = $1 AND service_type = ANY($2::varchar[]) AND status NOT IN ('Rejected', 'Collected')`,
      [citizenId, SERVICE_TYPES]
    );
    if (inProgress.length > 0) return res.status(409).json({ error: 'You already have a driving licence application in progress.' });

    let serviceType, linkedLearnerPermitId = null, surrenderStatus = null;
    let replacementReason = null, previousLicenceNumber = null, reportedLostAt = null;
    let renewalDamaged = false, renewalDamageProofReference = null;

    if (applicationType === 'New') {
      serviceType = 'Driving Licence Application';
      if (!(await hasCollectedNationalId(citizenId))) {
        return res.status(409).json({ error: 'You must already hold a National ID card before applying for a driving licence.' });
      }
      if (await getCurrentDrivingLicence(citizenId)) {
        return res.status(409).json({ error: 'You already hold a driving licence. Use renewal or replacement instead of a new application.' });
      }
      const permit = await getValidLearnerPermit(citizenId);
      if (!permit) {
        return res.status(409).json({ error: "A valid Learner's Permit is required before applying for a driving licence. You must pass the theory and practical driving tests to earn one first — see Driving Tests." });
      }
      if (permit.isExpired) {
        return res.status(409).json({ error: `Your Learner's Permit (${permit.licence_number}) expired on ${String(permit.expiry_date).slice(0, 10)}. You must sit the driving tests again to earn a new one.` });
      }
      linkedLearnerPermitId = permit.traffic_record_id;
      surrenderStatus = 'Awaiting Surrender';
    } else if (applicationType === 'Renewal') {
      serviceType = 'Driving Licence Renewal';
      const current = await getCurrentDrivingLicence(citizenId);
      if (!current) return res.status(409).json({ error: 'No current driving licence found to renew.' });
      renewalDamaged = !!b.renewalDamaged;
      renewalDamageProofReference = b.damageProofReference || null;
      if (!current.isExpired) {
        if (!renewalDamaged) {
          return res.status(409).json({
            error: `Your driving licence is still valid until ${String(current.expiry_date).slice(0, 10)}. You can only renew early if it is damaged, with proof.`,
            currentExpiryDate: current.expiry_date,
          });
        }
        if (!renewalDamageProofReference) return res.status(400).json({ error: 'A photo of the damaged licence is required to renew early.' });
      }
      previousLicenceNumber = current.licence_number;
    } else {
      serviceType = 'Driving Licence Replacement';
      replacementReason = b.replacementReason;
      previousLicenceNumber = b.previousLicenceNumber;
      if (!['Lost', 'Stolen', 'Damaged', 'Other'].includes(replacementReason)) {
        return res.status(400).json({ error: 'replacementReason is required (Lost, Stolen, Damaged, or Other).' });
      }
      if (!previousLicenceNumber) return res.status(400).json({ error: 'previousLicenceNumber is required.' });
      if (['Lost', 'Stolen'].includes(replacementReason)) {
        reportedLostAt = b.reportedLostAt;
        if (!reportedLostAt) return res.status(400).json({ error: replacementReason === 'Stolen' ? 'The date your licence was stolen is required.' : 'The date you lost the licence is required.' });
        const lostDate = new Date(reportedLostAt);
        if (Number.isNaN(lostDate.getTime()) || reportedLostAt > new Date().toISOString().slice(0, 10)) {
          return res.status(400).json({ error: 'The date reported cannot be in the future.' });
        }
        const eligibleFrom = addMonthsUTC(lostDate, REPLACEMENT_WAIT_MONTHS);
        if (new Date() < eligibleFrom) {
          return res.status(409).json({
            error: `A ${REPLACEMENT_WAIT_MONTHS}-month wait applies before a ${replacementReason.toLowerCase()} driving licence can be replaced. You can apply again from ${eligibleFrom.toISOString().slice(0, 10)}.`,
            eligibleFrom: eligibleFrom.toISOString().slice(0, 10),
          });
        }
      }
    }

    const capture = await resolveIdentityCapture(citizenId, biometricsSource, b);
    if (!capture.ok) return res.status(400).json({ error: capture.error });

    const referenceNumber = generateReference('TR');
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO traffic_records
            (citizen_id, application_reference, service_type, status, preferred_office_id, collection_office_id,
             photo_reference, biometric_reference_left, biometric_reference_right, photo_source,
             linked_learner_permit_id, surrender_status, renewal_damaged, renewal_damage_proof_reference,
             replacement_reason, previous_licence_number, reported_lost_at)
         VALUES ($1,$2,$3,'Submitted',$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING traffic_record_id`,
        [citizenId, referenceNumber, serviceType, preferredOfficeId,
          capture.photoReference, capture.biometricReferenceLeft, capture.biometricReferenceRight, biometricsSource,
          linkedLearnerPermitId, surrenderStatus, renewalDamaged, renewalDamageProofReference,
          replacementReason, previousLicenceNumber, reportedLostAt]
      );
      const recordId = rows[0].traffic_record_id;
      await indexApplication(client, {
        citizenId, departmentKey: 'traffic', serviceType, referenceNumber,
        sourceTable: 'traffic_records', sourceId: recordId, status: 'Submitted',
      });
      await client.query('COMMIT');
      await createNotification({
        userId: req.user.userId, title: `${serviceType} submitted`,
        message: `Reference ${referenceNumber}.${applicationType === 'New' ? " Your Learner's Permit will need to be surrendered when you collect your licence." : ''}`,
        type: 'Application Submitted',
      });
      res.status(201).json({ recordId, referenceNumber, status: 'Submitted' });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
}

/** GET /traffic/driving-licence — same shape as every other department list(), but scoped to
 *  just the three driving-licence service types (the generic factory's list() would otherwise
 *  return every traffic_records row, including vehicles, to officers). */
async function list(req, res, next) {
  try {
    if (['traffic_officer', 'system_administrator'].includes(req.user.roleKey)) {
      const { status } = req.query;
      const { rows } = await db.query(
        `SELECT t.*, c.first_name, c.last_name, c.permanent_identity_number FROM traffic_records t
         JOIN citizens c ON c.citizen_id = t.citizen_id
         WHERE t.service_type = ANY($1::varchar[]) AND ($2::text IS NULL OR t.status = $2)
         ORDER BY t.created_at DESC`,
        [SERVICE_TYPES, status || null]
      );
      return res.json({ records: rows });
    }
    if (!req.user.citizenId) return res.json({ records: [] });
    const { rows } = await db.query(
      `SELECT * FROM traffic_records WHERE citizen_id = $1 AND service_type = ANY($2::varchar[]) ORDER BY created_at DESC`,
      [req.user.citizenId, SERVICE_TYPES]
    );
    res.json({ records: rows });
  } catch (err) { next(err); }
}

const STATUS_FLOW = {
  'start-review': { from: 'Submitted', to: 'Under Review' },
  'verify-identity': { from: 'Under Review', to: 'Identity Verified' },
  'check-documents': { from: 'Identity Verified', to: 'Documents Checked' },
  'process': { from: 'Documents Checked', to: 'Processing' },
  'approve': { from: 'Processing', to: 'Approved' },
  'ready-for-collection': { from: 'Approved', to: 'Ready for Collection' },
  'collect': { from: 'Ready for Collection', to: 'Collected' },
};

/** The same 7-step officer workflow every other Traffic service already uses — nothing about
 *  that chain changes. The only new behaviour is at 'collect': when the record is a first
 *  licence relying on a Learner's Permit (surrender_status = 'Awaiting Surrender'), the SAME
 *  click that collects the licence also marks that permit surrendered — one officer action
 *  resolving both the physical hand-over and the collection, exactly like passport batch 15. */
async function transition(req, res, next) {
  try {
    if (!['traffic_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const t = STATUS_FLOW[req.params.action];
    if (!t) return res.status(400).json({ error: `Unknown action: ${req.params.action}` });
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM traffic_records WHERE traffic_record_id = $1 FOR UPDATE', [req.params.id]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
      const record = rows[0];
      if (record.status !== t.from) { await client.query('ROLLBACK'); return res.status(409).json({ error: `Cannot move from '${record.status}' to '${t.to}'.` }); }

      const resolvesSurrender = req.params.action === 'collect' && record.surrender_status === 'Awaiting Surrender';
      const licenceNumber = t.to === 'Approved' ? genNumber('DL') : record.licence_number;
      const officeId = req.body.officeId || record.collection_office_id;
      await client.query(
        // $1 explicitly cast everywhere — same "inconsistent types deduced for parameter $1" fix
        // documented in passport.controller.js's transition().
        `UPDATE traffic_records SET status = $1::varchar,
            licence_number = CASE WHEN $1::varchar = 'Approved' THEN $2 ELSE licence_number END,
            issue_date = CASE WHEN $1::varchar = 'Approved' THEN CURRENT_DATE ELSE issue_date END,
            expiry_date = CASE WHEN $1::varchar = 'Approved' THEN CURRENT_DATE + INTERVAL '${LICENCE_VALID_YEARS} years' ELSE expiry_date END,
            collection_office_id = CASE WHEN $1::varchar = 'Ready for Collection' THEN $3 ELSE collection_office_id END,
            ready_for_collection_at = CASE WHEN $1::varchar = 'Ready for Collection' THEN NOW() ELSE ready_for_collection_at END,
            collected_at = CASE WHEN $1::varchar = 'Collected' THEN NOW() ELSE collected_at END,
            surrender_status = CASE WHEN $5 THEN 'Surrendered' ELSE surrender_status END,
            surrender_verified_by_user_id = CASE WHEN $5 THEN $6 ELSE surrender_verified_by_user_id END,
            surrender_verified_at = CASE WHEN $5 THEN NOW() ELSE surrender_verified_at END,
            updated_at = NOW()
         WHERE traffic_record_id = $4`,
        [t.to, licenceNumber, officeId, record.traffic_record_id, resolvesSurrender, req.user.userId]
      );
      await syncApplicationStatus(client, { sourceTable: 'traffic_records', sourceId: record.traffic_record_id, status: t.to, completed: t.to === 'Collected' });
      await client.query('COMMIT');

      if (resolvesSurrender) {
        await recordAudit({
          userId: req.user.userId, departmentId: await getDepartmentId('traffic'), action: 'DRIVING_LICENCE_LEARNER_PERMIT_SURRENDERED',
          targetType: 'traffic_record', targetId: record.traffic_record_id,
          reason: "Officer verified the citizen's Learner's Permit in hand as part of the single collect action.",
        });
      }

      const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.citizen_id])).rows[0];
      if (userRow) {
        await createNotification({
          userId: userRow.user_id, title: `${record.service_type}: ${t.to}`,
          message: t.to === 'Ready for Collection'
            ? `Your driving licence (${record.application_reference}) is ready for collection.${resolvesSurrender === false && record.surrender_status === 'Awaiting Surrender' ? " Please bring your Learner's Permit to surrender it." : ''}`
            : `Reference ${record.application_reference} is now: ${t.to}.`,
          type: t.to === 'Ready for Collection' ? 'Ready for Collection' : t.to === 'Approved' ? 'Approval' : 'Status Change',
        });
      }
      res.json({ recordId: record.traffic_record_id, status: t.to, licenceNumber });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
}

/** POST /traffic/driving-licence/:id/surrender-failed body:{reason?} (officer) — the citizen
 *  could not produce their Learner's Permit at collection. Rejects outright, same as passport's
 *  failSurrender — if it's genuinely lost, Replacement is the right path once they hold the
 *  actual licence (not modelled here: the permit itself is never lost/replaced, only surrendered). */
async function failSurrender(req, res, next) {
  try {
    if (!['traffic_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const reason = (req.body.reason && String(req.body.reason).trim())
      || "The citizen's Learner's Permit was not presented for surrender, so this driving licence could not be collected.";
    const { rows } = await db.query(
      `UPDATE traffic_records SET status = 'Rejected', surrender_status = 'Not Surrendered', rejection_reason = $1, updated_at = NOW()
       WHERE traffic_record_id = $2 AND surrender_status = 'Awaiting Surrender' RETURNING *`,
      [reason, req.params.id]
    );
    if (rows.length === 0) return res.status(409).json({ error: "This application is not awaiting Learner's Permit surrender." });
    const record = rows[0];
    await syncApplicationStatus(db, { sourceTable: 'traffic_records', sourceId: record.traffic_record_id, status: 'Rejected', completed: true });
    await recordAudit({
      userId: req.user.userId, departmentId: await getDepartmentId('traffic'), action: 'DRIVING_LICENCE_SURRENDER_FAILED',
      targetType: 'traffic_record', targetId: record.traffic_record_id, reason,
    });
    const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.citizen_id])).rows[0];
    if (userRow) await createNotification({ userId: userRow.user_id, title: 'Driving licence application rejected', message: reason, type: 'Rejection' });
    res.json({ record });
  } catch (err) { next(err); }
}

// list/transition/apply/getEligibility/failSurrender are bespoke above; getOne, resubmit,
// requestInformation and reject all act on a single record by id (never scan the whole table),
// so the generic factory's versions are safe to reuse as-is — same table, same idColumn.
const generic = makeDepartmentController({
  table: 'traffic_records',
  idColumn: 'traffic_record_id',
  deptKey: 'traffic',
  officerRoleKey: 'traffic_officer',
  refPrefix: 'TR',
  serviceTypes: SERVICE_TYPES,
  extraInsertFields: [
    { column: 'photo_reference', fromBody: 'photoReference' },
    { column: 'biometric_reference_left', fromBody: 'biometricReferenceLeft' },
    { column: 'biometric_reference_right', fromBody: 'biometricReferenceRight' },
    { column: 'renewal_damage_proof_reference', fromBody: 'damageProofReference' },
  ],
  statusFlow: STATUS_FLOW,
});

module.exports = {
  getEligibility, apply, list, transition, failSurrender,
  getOne: generic.getOne, resubmit: generic.resubmit, requestInformation: generic.requestInformation, reject: generic.reject,
};
