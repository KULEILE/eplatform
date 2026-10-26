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
//
// Migration 072 (Batch 26) changed two things, both from the same message:
//   5. The citizen now chooses a vehicle CATEGORY (Lesotho's four classes: A motorcycles, B light
//      vehicles/cars, C minibuses/light trucks, D heavy trucks/buses) on a New application — "in
//      Lesotho we have four categories of license ... citizen must select which code is applying
//      for." A Renewal or Replacement carries the category forward from the citizen's existing
//      licence automatically rather than asking again (see resolveLicenceCategory below).
//   6. The old 7-step generic officer review chain (start-review/verify-identity/check-documents/
//      process/approve/ready-for-collection) is GONE for this service — "the only steps should
//      require officer is to check the payment is legit because license is not free ... after
//      officer confirm that payment is legit the system generate license automatically." A New
//      applicant was already identity-verified to earn the Learner's Permit this depends on, and
//      a Renewal/Replacement applicant already holds a previously-issued licence, so re-running
//      that whole chain here was pure redundancy. The only two officer actions left are
//      'confirm-payment' (reviews the payment reference + receipt photo the citizen supplied at
//      apply — same proof pattern migration 033 already uses for the Passport fee — and, in that
//      same click, both records who verified it and generates the licence number/issue/expiry
//      dates) and 'collect' (the physical hand-over, unchanged, including the existing Learner's
//      Permit surrender step for a New licence).
// ============================================================================================

const REPLACEMENT_WAIT_MONTHS = 3;
const LICENCE_VALID_YEARS = 5;
const SERVICE_TYPES = ['Driving Licence Application', 'Driving Licence Renewal', 'Driving Licence Replacement'];
const VEHICLE_CATEGORIES = ['A', 'B', 'C', 'D'];

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

/** Looks up one of THIS citizen's own past driving-licence records by its licence number — used
 *  on a Replacement application to find what vehicle category the licence being replaced was, so
 *  the citizen is never asked to re-select it. Scoped to citizen_id so nobody can pull someone
 *  else's licence category by guessing a licence number. */
async function getRecordByLicenceNumber(citizenId, licenceNumber) {
  const { rows } = await db.query(
    `SELECT * FROM traffic_records WHERE citizen_id = $1 AND service_type = ANY($2::varchar[]) AND licence_number = $3 LIMIT 1`,
    [citizenId, SERVICE_TYPES, licenceNumber]
  );
  return rows[0] || null;
}

/** Resolves the vehicle category (A/B/C/D) for an application — "citizen must select which code
 *  is applying for" only really applies to a brand-new licence; a Renewal or Replacement is for
 *  the SAME class of licence the citizen already holds, so it's carried forward automatically
 *  rather than asked again. Falls back to requiring the citizen supply one directly only when
 *  there's genuinely no category on file to carry forward (e.g. a legacy record from before this
 *  batch, or a replacement for a licence number this system has no record of at all). Returns
 *  { ok: true, category } or { ok: false, error }. */
function resolveLicenceCategory(applicationType, bodyCategory, carryForwardRecord) {
  if (applicationType === 'New') {
    if (!VEHICLE_CATEGORIES.includes(bodyCategory)) {
      return { ok: false, error: `licenceCategory is required and must be one of: ${VEHICLE_CATEGORIES.join(', ')}.` };
    }
    return { ok: true, category: bodyCategory };
  }
  if (carryForwardRecord && VEHICLE_CATEGORIES.includes(carryForwardRecord.licence_category)) {
    return { ok: true, category: carryForwardRecord.licence_category };
  }
  if (VEHICLE_CATEGORIES.includes(bodyCategory)) {
    return { ok: true, category: bodyCategory };
  }
  return { ok: false, error: `We don't have a vehicle category on file for your existing licence — please select one (${VEHICLE_CATEGORIES.join(', ')}).` };
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
        licenceCategory: currentLicence.licence_category,
      } : null,
      hasInProgressApplication: inProgressRows.length > 0,
      inProgressApplication: inProgressRows[0] || null,
      replacementWaitMonths: REPLACEMENT_WAIT_MONTHS,
      vehicleCategories: VEHICLE_CATEGORIES,
    });
  } catch (err) { next(err); }
}

/** POST /traffic/driving-licence/apply — body: { applicationType: 'New'|'Renewal'|'Replacement',
 *  preferredOfficeId, biometricsSource: 'id'|'new', photoReference?, biometricReferenceLeft?,
 *  biometricReferenceRight?, licenceCategory? ('A'|'B'|'C'|'D' — required for New, carried
 *  forward automatically for Renewal/Replacement, see resolveLicenceCategory above),
 *  paymentReference, receiptImageReference (the licence fee — required on all three, same proof
 *  shape migration 033 already uses for the Passport fee), renewalDamaged?, damageProofReference?,
 *  replacementReason?, previousLicenceNumber?, reportedLostAt? }. */
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
    if (!b.paymentReference || !b.receiptImageReference) {
      return res.status(400).json({ error: 'paymentReference and receiptImageReference are required — the licence fee must be paid before applying.' });
    }

    const { rows: inProgress } = await db.query(
      `SELECT 1 FROM traffic_records WHERE citizen_id = $1 AND service_type = ANY($2::varchar[]) AND status NOT IN ('Rejected', 'Collected')`,
      [citizenId, SERVICE_TYPES]
    );
    if (inProgress.length > 0) return res.status(409).json({ error: 'You already have a driving licence application in progress.' });

    let serviceType, linkedLearnerPermitId = null, surrenderStatus = null;
    let replacementReason = null, previousLicenceNumber = null, reportedLostAt = null;
    let renewalDamaged = false, renewalDamageProofReference = null;
    let carryForwardRecord = null;

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
      carryForwardRecord = current;
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
      carryForwardRecord = await getRecordByLicenceNumber(citizenId, previousLicenceNumber);
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

    const categoryResolution = resolveLicenceCategory(applicationType, b.licenceCategory, carryForwardRecord);
    if (!categoryResolution.ok) return res.status(400).json({ error: categoryResolution.error });
    const licenceCategory = categoryResolution.category;

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
             replacement_reason, previous_licence_number, reported_lost_at,
             licence_category, payment_reference, receipt_image_reference)
         VALUES ($1,$2,$3,'Submitted',$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING traffic_record_id`,
        [citizenId, referenceNumber, serviceType, preferredOfficeId,
          capture.photoReference, capture.biometricReferenceLeft, capture.biometricReferenceRight, biometricsSource,
          linkedLearnerPermitId, surrenderStatus, renewalDamaged, renewalDamageProofReference,
          replacementReason, previousLicenceNumber, reportedLostAt,
          licenceCategory, b.paymentReference, b.receiptImageReference]
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

// Batch 26: the old 7-step generic review chain (start-review/verify-identity/check-documents/
// process/approve/ready-for-collection) is gone for this service — see the header comment at the
// top of this file for why. Two officer actions remain:
//   'confirm-payment' — the officer's only real review step. Reviews the payment_reference +
//     receipt_image_reference the citizen supplied at apply (see the frontend's receipt display)
//     and, in that same click, both records who verified it and generates the licence number and
//     issue/expiry dates — "after officer confirm that payment is legit the system generate
//     license automatically." Goes straight from 'Submitted' to 'Ready for Collection': there is
//     no separate "card is being produced" wait modelled here, since nothing about producing it
//     needs a second officer action once the payment is confirmed.
//   'collect' — the physical hand-over, including the existing Learner's Permit surrender step
//     for a New licence (see the comment on transition() below). Batch 27 added one requirement
//     to this action: the citizen's own signature, captured on a pad at the counter the same way
//     migration 035 already does for National ID/passport/birth certificate/police clearance —
//     "the citizen still needs to sign when they collect it and that signature putted on the
//     license." It's stored and shown on the card the same way (see DrivingLicenceDocument.jsx).
const STATUS_FLOW = {
  'confirm-payment': { from: 'Submitted', to: 'Ready for Collection' },
  'collect': { from: 'Ready for Collection', to: 'Collected' },
};

/** The only new behaviour at 'collect' (unchanged from before this batch): when the record is a
 *  first licence relying on a Learner's Permit (surrender_status = 'Awaiting Surrender'), the
 *  SAME click that collects the licence also marks that permit surrendered — one officer action
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

      const isConfirmPayment = req.params.action === 'confirm-payment';
      if (isConfirmPayment && (!record.payment_reference || !record.receipt_image_reference)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'There is no payment reference/receipt on file for this application.' });
      }

      const isCollect = req.params.action === 'collect';
      if (isCollect && !req.body.signatureReference) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: "The citizen's signature is required before the licence can be marked collected." });
      }

      const resolvesSurrender = isCollect && record.surrender_status === 'Awaiting Surrender';
      const licenceNumber = isConfirmPayment ? genNumber('DL') : record.licence_number;
      const officeId = req.body.officeId || record.collection_office_id;
      await client.query(
        // $1 explicitly cast everywhere — same "inconsistent types deduced for parameter $1" fix
        // documented in passport.controller.js's transition().
        `UPDATE traffic_records SET status = $1::varchar,
            licence_number = CASE WHEN $7 THEN $2 ELSE licence_number END,
            issue_date = CASE WHEN $7 THEN CURRENT_DATE ELSE issue_date END,
            expiry_date = CASE WHEN $7 THEN CURRENT_DATE + INTERVAL '${LICENCE_VALID_YEARS} years' ELSE expiry_date END,
            collection_office_id = CASE WHEN $7 THEN $3 ELSE collection_office_id END,
            ready_for_collection_at = CASE WHEN $7 THEN NOW() ELSE ready_for_collection_at END,
            payment_verified_by_user_id = CASE WHEN $7 THEN $6 ELSE payment_verified_by_user_id END,
            payment_verified_at = CASE WHEN $7 THEN NOW() ELSE payment_verified_at END,
            collected_at = CASE WHEN $5 THEN NOW() ELSE collected_at END,
            surrender_status = CASE WHEN $5 THEN 'Surrendered' ELSE surrender_status END,
            surrender_verified_by_user_id = CASE WHEN $5 THEN $6 ELSE surrender_verified_by_user_id END,
            surrender_verified_at = CASE WHEN $5 THEN NOW() ELSE surrender_verified_at END,
            signature_reference = CASE WHEN $8 THEN $9 ELSE signature_reference END,
            updated_at = NOW()
         WHERE traffic_record_id = $4`,
        [t.to, licenceNumber, officeId, record.traffic_record_id, resolvesSurrender, req.user.userId, isConfirmPayment, isCollect, req.body.signatureReference || null]
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
      if (isConfirmPayment) {
        await recordAudit({
          userId: req.user.userId, departmentId: await getDepartmentId('traffic'), action: 'DRIVING_LICENCE_PAYMENT_CONFIRMED',
          targetType: 'traffic_record', targetId: record.traffic_record_id,
          reason: `Officer confirmed payment reference ${record.payment_reference} against the uploaded receipt and the licence (${licenceNumber}) was generated automatically.`,
        });
      }

      const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.citizen_id])).rows[0];
      if (userRow) {
        await createNotification({
          userId: userRow.user_id, title: `${record.service_type}: ${t.to}`,
          message: t.to === 'Ready for Collection'
            ? `Your driving licence (${licenceNumber}) has been generated and is ready for collection.${resolvesSurrender === false && record.surrender_status === 'Awaiting Surrender' ? " Please bring your Learner's Permit to surrender it." : ''}`
            : `Reference ${record.application_reference} is now: ${t.to}.`,
          type: t.to === 'Ready for Collection' ? 'Ready for Collection' : 'Status Change',
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

/** GET /traffic/driving-licence/:id — Batch 27: joins the citizen's own bio-data (name, date of
 *  birth, permanent ID) and the collection office's district, the same way passport.controller.js's
 *  getOne does for PassportDocument.jsx, so the card display (DrivingLicenceDocument.jsx) can
 *  render the actual licence rather than just the workflow status the generic getOne returned.
 *  Also resolves "First Issue" — the real card always shows the citizen's ORIGINAL first-licence
 *  date, not this particular record's own issue date, so it stays fixed across renewals/
 *  replacements: the earliest issue_date among this citizen's own Collected driving licence rows. */
async function getOne(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT tr.*, o.name AS collection_office_name, d.name AS collection_office_district,
              c.first_name, c.middle_name, c.last_name, c.sex, c.date_of_birth, c.permanent_identity_number,
              (SELECT MIN(issue_date) FROM traffic_records
                 WHERE citizen_id = tr.citizen_id AND service_type = ANY($2::varchar[]) AND status = 'Collected'
                   AND issue_date IS NOT NULL) AS first_issue_date
       FROM traffic_records tr
       LEFT JOIN offices o ON o.office_id = tr.collection_office_id
       LEFT JOIN districts d ON d.district_id = o.district_id
       JOIN citizens c ON c.citizen_id = tr.citizen_id
       WHERE tr.traffic_record_id = $1`,
      [req.params.id, SERVICE_TYPES]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Record not found.' });
    const record = rows[0];
    const isOwner = req.user.citizenId === record.citizen_id;
    const isOfficer = ['traffic_officer', 'system_administrator'].includes(req.user.roleKey);
    if (!isOwner && !isOfficer) return res.status(403).json({ error: 'You do not have access to this record.' });
    res.json({ record });
  } catch (err) { next(err); }
}

// list/transition/apply/getEligibility/failSurrender/getOne are bespoke; resubmit,
// requestInformation and reject all act on a single record by id (never scan the whole table)
// and need none of getOne's extra display fields, so the generic factory's versions of those
// three are safe to reuse as-is — same table, same idColumn.
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
    { column: 'payment_reference', fromBody: 'paymentReference' },
    { column: 'receipt_image_reference', fromBody: 'receiptImageReference' },
  ],
  statusFlow: STATUS_FLOW,
});

module.exports = {
  getEligibility, apply, list, transition, failSurrender, getOne,
  resubmit: generic.resubmit, requestInformation: generic.requestInformation, reject: generic.reject,
};
