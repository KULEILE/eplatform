const db = require('../config/db');
const { generateReference } = require('../utils/referenceGenerator');
const { indexApplication, syncApplicationStatus, getDepartmentId } = require('../utils/lookup');
const { createNotification } = require('../utils/notify');
const { recordAudit } = require('../utils/audit');

// ============================================================================================
// PASSPORT — client-requested enhancement (migration 064):
//  1. 16+ only, and a citizen applying for THEMSELVES must already hold a collected National ID
//     card (ID first, then passport).
//  2. A parent can apply on behalf of a child under 16, but only a child linked to them on that
//     child's birth record — never an unrelated child. The moment that child turns 16, the parent
//     can no longer apply for them; the child must apply themselves from then on.
//  3. The citizen chooses, every time: reuse their National ID photo, or capture a fresh one.
//  4. Renewal is blocked unless the current passport has actually expired — unless the citizen
//     declares its pages are full, a real alternative reason to renew early.
//  5. New: Replacement (Lost/Stolen) — a supporting document plus a mandatory 3-month wait from
//     the reported date, same shape as National ID replacement.
//  6. The current passport (if any) is always made available to the frontend so it can be shown
//     on screen before the citizen decides to renew/replace it.
//
// citizen_id is always the passport HOLDER/subject (every existing query already assumes this).
// applicant_citizen_id is whoever actually submitted the application — the same person as
// citizen_id for an adult applying for themselves, or the parent's citizen_id for a child.
// ============================================================================================

const MIN_PASSPORT_AGE = 16;
const PASSPORT_LOST_WAIT_MONTHS = 3;

function calculateAgeYears(dateOfBirth) {
  const dob = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age -= 1;
  return age;
}

/** Same date math used for National ID's lost/stolen wait (homeAffairs.controller.js). */
function addMonthsUTC(date, months) {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/** Decides who the passport is actually FOR, and whether the logged-in citizen is allowed to
 *  apply/renew/replace for them. Returns { ok:true, subjectCitizenId, isOnBehalf } or
 *  { ok:false, status, error }. Shared by apply/applyRenewal/applyReplacement so the age + birth
 *  record relationship rules live in exactly one place. */
async function resolveSubjectAndAuthorize(req, rawSubjectCitizenId) {
  const subjectCitizenId = rawSubjectCitizenId ? Number(rawSubjectCitizenId) : req.user.citizenId;
  const isOnBehalf = subjectCitizenId !== req.user.citizenId;

  const { rows: subjectRows } = await db.query('SELECT citizen_id, date_of_birth FROM citizens WHERE citizen_id = $1', [subjectCitizenId]);
  if (subjectRows.length === 0) return { ok: false, status: 404, error: 'Citizen record not found.' };
  const subjectAge = calculateAgeYears(subjectRows[0].date_of_birth);

  if (isOnBehalf) {
    // Only a child genuinely linked to this parent on their OWN birth record — never an
    // unrelated child, even one the parent types a real citizen_id for. Mirrors the same
    // dual-parent-column check listMyBirthCertificates uses in homeAffairsServices2.controller.js.
    const { rows: relRows } = await db.query(
      `SELECT 1 FROM birth_records
       WHERE citizen_id = $1 AND registration_status = 'Approved'
         AND (parent_citizen_id = $2 OR father_citizen_id = $2 OR mother_citizen_id = $2)`,
      [subjectCitizenId, req.user.citizenId]
    );
    if (relRows.length === 0) {
      return {
        ok: false, status: 403,
        error: 'This child is not linked to your identity. You can only apply for a passport on behalf of a child recorded as yours on their birth certificate.',
      };
    }
    if (subjectAge >= MIN_PASSPORT_AGE) {
      return { ok: false, status: 409, error: `This child is now ${subjectAge} years old and must apply for their own passport — a parent can no longer apply on their behalf.` };
    }
  } else if (subjectAge < MIN_PASSPORT_AGE) {
    return { ok: false, status: 400, error: `You must be at least ${MIN_PASSPORT_AGE} years old to apply for a passport. A parent can apply on behalf of a child under ${MIN_PASSPORT_AGE}.` };
  }

  return { ok: true, subjectCitizenId, isOnBehalf, subjectAge };
}

/** The subject's own collected National ID photo, if any — used both to decide whether "reuse
 *  my ID photo" can even be offered, and to resolve it server-side so the client never has to be
 *  trusted to send the right reference. Children never have one (16+ only), which is exactly why
 *  they always have to capture a fresh photo instead. */
async function getIdPhotoReference(citizenId) {
  const { rows } = await db.query(
    `SELECT photo_reference FROM national_id_cards WHERE citizen_id = $1 AND production_status = 'Collected' ORDER BY approval_date DESC LIMIT 1`,
    [citizenId]
  );
  return rows[0]?.photo_reference || null;
}

/** Whether the citizen holds a collected National ID card at all — kept separate from
 *  getIdPhotoReference above: a card can exist without a stored photo (photo_reference is
 *  nullable on national_id_cards), and this gate must not depend on whether a photo happens to
 *  be on file. "Reuse my ID photo" being unavailable just means that one option is hidden; it
 *  must never also mean "you don't have an ID." */
async function hasCollectedNationalId(citizenId) {
  const { rows } = await db.query(
    `SELECT 1 FROM national_id_cards WHERE citizen_id = $1 AND production_status = 'Collected' LIMIT 1`,
    [citizenId]
  );
  return rows.length > 0;
}

/** Resolves photoReference from the citizen's photoSource choice ('id' | 'new'). Centralised so
 *  apply/applyRenewal/applyReplacement enforce the same rule: 'id' is only honoured with a real
 *  ID photo on file (resolved server-side, never trusting a client-sent reference for it); 'new'
 *  requires an actual captured photoReference. */
async function resolvePhotoReference(subjectCitizenId, photoSource, photoReference) {
  if (photoSource === 'id') {
    const idPhoto = await getIdPhotoReference(subjectCitizenId);
    if (!idPhoto) return { ok: false, error: 'No National ID photo is available to reuse.' };
    return { ok: true, photoReference: idPhoto };
  }
  if (!photoReference) return { ok: false, error: 'A photo is required.' };
  return { ok: true, photoReference };
}

/** Summarises one citizen's passport situation — their current (collected) passport, if any,
 *  and whether an application is already in progress. Used for both the logged-in citizen
 *  themselves and each of their children in getEligibility, and reused by apply/renew/replace to
 *  find the "previous" passport for Renewal/Replacement. */
async function summarizePassportSubject(citizenId) {
  const { rows } = await db.query('SELECT * FROM passport_records WHERE citizen_id = $1 ORDER BY created_at DESC', [citizenId]);
  const hasInProgressApplication = rows.some((r) => !['Rejected', 'Collected'].includes(r.status));
  const collectedRows = rows.filter((r) => r.status === 'Collected');
  collectedRows.sort((a, b) => new Date(b.expiry_date || b.created_at) - new Date(a.expiry_date || a.created_at));
  const collected = collectedRows[0] || null;
  const today = new Date().toISOString().slice(0, 10);
  const isExpired = !!(collected && collected.expiry_date && String(collected.expiry_date).slice(0, 10) < today);
  const currentPassport = collected ? {
    passportRecordId: collected.passport_record_id, passportNumber: collected.passport_number, passportType: collected.passport_type,
    issueDate: collected.issue_date, expiryDate: collected.expiry_date, isExpired, photoReference: collected.photo_reference,
  } : null;
  return { hasInProgressApplication, hasCurrentPassport: !!currentPassport, currentPassport, collectedRecord: collected };
}

/** GET /api/passport/eligibility — everything Passport.jsx needs to decide what to show: the
 *  logged-in citizen's own age/ID/passport situation, AND every child they can legitimately apply
 *  for (linked on a birth record, so the "choose which child" picker is a real list, not a typed
 *  ID), each with their own age/passport situation — see migration 064. */
async function getEligibility(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required.' });
    const selfId = req.user.citizenId;

    const { rows: selfRows } = await db.query('SELECT date_of_birth FROM citizens WHERE citizen_id = $1', [selfId]);
    if (selfRows.length === 0) return res.status(404).json({ error: 'Citizen record not found.' });
    const age = calculateAgeYears(selfRows[0].date_of_birth);
    const idPhotoReference = await getIdPhotoReference(selfId);
    const hasId = await hasCollectedNationalId(selfId);
    const { collectedRecord, ...selfSummary } = await summarizePassportSubject(selfId);

    const { rows: childRows } = await db.query(
      `SELECT c.citizen_id, c.first_name, c.middle_name, c.last_name, c.date_of_birth
       FROM birth_records br JOIN citizens c ON c.citizen_id = br.citizen_id
       WHERE br.registration_status = 'Approved' AND br.citizen_id IS NOT NULL AND br.citizen_id != $1
         AND (br.parent_citizen_id = $1 OR br.father_citizen_id = $1 OR br.mother_citizen_id = $1)
       ORDER BY c.date_of_birth DESC`,
      [selfId]
    );
    const children = [];
    for (const child of childRows) {
      const childAge = calculateAgeYears(child.date_of_birth);
      const { collectedRecord: _unused, ...childSummary } = await summarizePassportSubject(child.citizen_id);
      children.push({
        citizenId: child.citizen_id, firstName: child.first_name, middleName: child.middle_name, lastName: child.last_name,
        dateOfBirth: child.date_of_birth, age: childAge, canApplyOnBehalf: childAge < MIN_PASSPORT_AGE,
        ...childSummary,
      });
    }

    res.json({
      minimumAge: MIN_PASSPORT_AGE,
      replacementWaitMonths: PASSPORT_LOST_WAIT_MONTHS,
      self: { citizenId: selfId, age, meetsMinimumAge: age >= MIN_PASSPORT_AGE, hasCollectedNationalId: hasId, idPhotoReference, ...selfSummary },
      children,
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/passport/apply — body: { subjectCitizenId?, passportType, preferredOfficeId,
 *  photoSource, photoReference?, paymentReference, receiptImageReference }. subjectCitizenId is
 *  omitted (or equal to the caller) for an adult applying for themselves; set to a child's
 *  citizen_id for a parent applying on the child's behalf — see resolveSubjectAndAuthorize. */
async function apply(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to apply for a passport.' });
    const auth = await resolveSubjectAndAuthorize(req, req.body.subjectCitizenId);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const { subjectCitizenId, isOnBehalf } = auth;

    const { passportType, preferredOfficeId, photoSource, photoReference, paymentReference, receiptImageReference } = req.body;
    if (!preferredOfficeId) {
      return res.status(400).json({ error: 'preferredOfficeId is required — choose the branch where you will collect the passport.' });
    }
    if (!paymentReference || !receiptImageReference) {
      return res.status(400).json({ error: 'paymentReference and receiptImageReference are required — the passport fee must be paid before applying.' });
    }

    // A child (on-behalf application) is never eligible for a National ID, so this gate only
    // ever applies to an adult applying for themselves.
    if (!isOnBehalf) {
      if (!(await hasCollectedNationalId(subjectCitizenId))) {
        return res.status(409).json({ error: 'You must already hold a National ID card before applying for a passport. Please apply for your National ID first.' });
      }
    }

    const { rows: inProgress } = await db.query(
      `SELECT 1 FROM passport_records WHERE citizen_id = $1 AND status NOT IN ('Rejected', 'Collected')`,
      [subjectCitizenId]
    );
    if (inProgress.length > 0) {
      return res.status(409).json({ error: isOnBehalf ? 'This child already has a passport application in progress.' : 'You already have a passport application in progress.' });
    }
    const { rows: alreadyCollected } = await db.query(
      `SELECT 1 FROM passport_records WHERE citizen_id = $1 AND status = 'Collected'`,
      [subjectCitizenId]
    );
    if (alreadyCollected.length > 0) {
      return res.status(409).json({ error: isOnBehalf ? 'This child already has a passport. Use renewal or replacement instead.' : 'You already have a passport. Use renewal or replacement instead of a new application.' });
    }

    const photoResolution = await resolvePhotoReference(subjectCitizenId, photoSource, photoReference);
    if (!photoResolution.ok) return res.status(400).json({ error: photoResolution.error });

    const referenceNumber = generateReference('PA');
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO passport_records (citizen_id, applicant_citizen_id, application_reference, passport_type, status, preferred_office_id, collection_office_id, photo_reference, payment_reference, receipt_image_reference)
         VALUES ($1,$2,$3,$4,'Submitted',$5,$5,$6,$7,$8) RETURNING passport_record_id`,
        [subjectCitizenId, req.user.citizenId, referenceNumber, passportType || 'Ordinary', preferredOfficeId, photoResolution.photoReference, paymentReference, receiptImageReference]
      );
      await indexApplication(client, {
        citizenId: req.user.citizenId, departmentKey: 'passport', serviceType: 'Passport Application',
        referenceNumber, sourceTable: 'passport_records', sourceId: rows[0].passport_record_id, status: 'Submitted',
      });
      await client.query('COMMIT');
      await createNotification({
        userId: req.user.userId, title: 'Passport application submitted',
        message: `Reference ${referenceNumber}.${isOnBehalf ? ' Submitted on behalf of your child.' : ''}`, type: 'Application Submitted',
      });
      res.status(201).json({ passportRecordId: rows[0].passport_record_id, referenceNumber, status: 'Submitted' });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

/** POST /api/passport/renew — body adds renewalReason ('Expired' | 'Pages Full') on top of
 *  apply()'s fields. Requires the subject to already hold a COLLECTED passport. Blocked unless
 *  that passport has actually expired, unless the citizen declares renewalReason = 'Pages Full'. */
async function applyRenewal(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to apply for a passport.' });
    const auth = await resolveSubjectAndAuthorize(req, req.body.subjectCitizenId);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const { subjectCitizenId, isOnBehalf } = auth;

    const { passportType, preferredOfficeId, photoSource, photoReference, paymentReference, receiptImageReference, renewalReason } = req.body;
    if (!preferredOfficeId) {
      return res.status(400).json({ error: 'preferredOfficeId is required — choose the branch where you will collect the passport.' });
    }
    if (!paymentReference || !receiptImageReference) {
      return res.status(400).json({ error: 'paymentReference and receiptImageReference are required — the passport fee must be paid before renewing.' });
    }

    const { rows: inProgress } = await db.query(
      `SELECT 1 FROM passport_records WHERE citizen_id = $1 AND status NOT IN ('Rejected', 'Collected')`,
      [subjectCitizenId]
    );
    if (inProgress.length > 0) {
      return res.status(409).json({ error: isOnBehalf ? 'This child already has a passport application in progress.' : 'You already have a passport application in progress.' });
    }

    const { collectedRecord: previous } = await summarizePassportSubject(subjectCitizenId);
    if (!previous) {
      return res.status(409).json({ error: 'No current passport found. Use the standard Passport Application for a first-time passport.' });
    }

    const today = new Date().toISOString().slice(0, 10);
    const isExpired = !!(previous.expiry_date && String(previous.expiry_date).slice(0, 10) < today);
    if (!isExpired) {
      if (renewalReason !== 'Pages Full') {
        return res.status(409).json({
          error: `Your current passport is not yet expired (it expires on ${String(previous.expiry_date).slice(0, 10)}). Renewal is only available once it has expired, unless your passport's pages are full.`,
          currentPassportNumber: previous.passport_number, expiryDate: previous.expiry_date,
        });
      }
    }

    const photoResolution = await resolvePhotoReference(subjectCitizenId, photoSource, photoReference);
    if (!photoResolution.ok) return res.status(400).json({ error: photoResolution.error });
    // Falls back to the previous passport's photo only when no explicit choice was resolvable,
    // same spirit as National ID renewal — but photoSource ('id' | 'new') is always honoured
    // first, since that's the citizen's explicit choice for this specific application.
    const resolvedPhotoReference = photoResolution.photoReference || previous.photo_reference;

    const referenceNumber = generateReference('PA');
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO passport_records
            (citizen_id, applicant_citizen_id, application_reference, passport_type, status, preferred_office_id, collection_office_id,
             photo_reference, payment_reference, receipt_image_reference, application_type, previous_passport_number, renewal_reason)
         VALUES ($1,$2,$3,$4,'Submitted',$5,$5,$6,$7,$8,'Renewal',$9,$10) RETURNING passport_record_id`,
        [subjectCitizenId, req.user.citizenId, referenceNumber, passportType || previous.passport_type, preferredOfficeId,
          resolvedPhotoReference, paymentReference, receiptImageReference, previous.passport_number || null, isExpired ? 'Expired' : 'Pages Full']
      );
      await indexApplication(client, {
        citizenId: req.user.citizenId, departmentKey: 'passport', serviceType: 'Passport Renewal',
        referenceNumber, sourceTable: 'passport_records', sourceId: rows[0].passport_record_id, status: 'Submitted',
      });
      await client.query('COMMIT');
      await createNotification({ userId: req.user.userId, title: 'Passport renewal submitted', message: `Reference ${referenceNumber}.`, type: 'Application Submitted' });
      res.status(201).json({ passportRecordId: rows[0].passport_record_id, referenceNumber, status: 'Submitted' });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

/** POST /api/passport/replace — new service: passport Replacement (Lost/Stolen). Requires the
 *  subject to already hold a COLLECTED passport; a mandatory 3-month wait applies from the
 *  reported date, same shape as National ID replacement (homeAffairs.controller.js). */
async function applyReplacement(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to apply for a passport.' });
    const auth = await resolveSubjectAndAuthorize(req, req.body.subjectCitizenId);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const { subjectCitizenId, isOnBehalf } = auth;

    const {
      passportType, preferredOfficeId, photoSource, photoReference, paymentReference, receiptImageReference,
      replacementReason, replacementDetails, replacementProofReference, reportedLostAt,
    } = req.body;

    if (!preferredOfficeId) {
      return res.status(400).json({ error: 'preferredOfficeId is required — choose the branch where you will collect the passport.' });
    }
    if (!paymentReference || !receiptImageReference) {
      return res.status(400).json({ error: 'paymentReference and receiptImageReference are required — the passport fee must be paid before applying.' });
    }
    if (!['Lost', 'Stolen'].includes(replacementReason)) {
      return res.status(400).json({ error: "replacementReason must be 'Lost' or 'Stolen'." });
    }
    if (!replacementProofReference) {
      return res.status(400).json({ error: 'A supporting document is required for a replacement application.' });
    }
    if (!reportedLostAt) {
      return res.status(400).json({ error: replacementReason === 'Stolen' ? 'The date your passport was stolen is required.' : 'The date you lost the passport is required.' });
    }
    const lostDate = new Date(reportedLostAt);
    if (Number.isNaN(lostDate.getTime()) || reportedLostAt > new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ error: 'The date reported cannot be in the future.' });
    }
    const eligibleFrom = addMonthsUTC(lostDate, PASSPORT_LOST_WAIT_MONTHS);
    if (new Date() < eligibleFrom) {
      return res.status(409).json({
        error: `A ${PASSPORT_LOST_WAIT_MONTHS}-month wait applies before a ${replacementReason.toLowerCase()} passport can be replaced. You can apply again from ${eligibleFrom.toISOString().slice(0, 10)}.`,
        eligibleFrom: eligibleFrom.toISOString().slice(0, 10),
      });
    }

    const { rows: inProgress } = await db.query(
      `SELECT 1 FROM passport_records WHERE citizen_id = $1 AND status NOT IN ('Rejected', 'Collected')`,
      [subjectCitizenId]
    );
    if (inProgress.length > 0) {
      return res.status(409).json({ error: isOnBehalf ? 'This child already has a passport application in progress.' : 'You already have a passport application in progress.' });
    }

    const { collectedRecord: previous } = await summarizePassportSubject(subjectCitizenId);
    if (!previous) {
      return res.status(409).json({ error: 'No current passport found. Use the standard Passport Application for a first-time passport.' });
    }

    const photoResolution = await resolvePhotoReference(subjectCitizenId, photoSource, photoReference);
    if (!photoResolution.ok) return res.status(400).json({ error: photoResolution.error });

    const referenceNumber = generateReference('PA');
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO passport_records
            (citizen_id, applicant_citizen_id, application_reference, passport_type, status, preferred_office_id, collection_office_id,
             photo_reference, payment_reference, receipt_image_reference, application_type, previous_passport_number,
             replacement_reason, replacement_details, replacement_proof_reference, reported_lost_at)
         VALUES ($1,$2,$3,$4,'Submitted',$5,$5,$6,$7,$8,'Replacement',$9,$10,$11,$12,$13) RETURNING passport_record_id`,
        [subjectCitizenId, req.user.citizenId, referenceNumber, passportType || previous.passport_type, preferredOfficeId,
          photoResolution.photoReference, paymentReference, receiptImageReference, previous.passport_number || null,
          replacementReason, replacementDetails || null, replacementProofReference, reportedLostAt]
      );
      await indexApplication(client, {
        citizenId: req.user.citizenId, departmentKey: 'passport', serviceType: 'Passport Replacement',
        referenceNumber, sourceTable: 'passport_records', sourceId: rows[0].passport_record_id, status: 'Submitted',
      });
      await client.query('COMMIT');
      await createNotification({ userId: req.user.userId, title: 'Passport replacement submitted', message: `Reference ${referenceNumber}.`, type: 'Application Submitted' });
      res.status(201).json({ passportRecordId: rows[0].passport_record_id, referenceNumber, status: 'Submitted' });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    if (req.user.roleKey === 'passport_officer' || req.user.roleKey === 'system_administrator') {
      const { status } = req.query;
      const { rows } = await db.query(
        `SELECT pr.*, c.first_name, c.last_name, c.permanent_identity_number FROM passport_records pr
         JOIN citizens c ON c.citizen_id = pr.citizen_id WHERE $1::text IS NULL OR pr.status = $1 ORDER BY pr.created_at DESC`,
        [status || null]
      );
      return res.json({ passportRecords: rows });
    }
    if (!req.user.citizenId) return res.json({ passportRecords: [] });
    // Includes both: passports this citizen HOLDS, and passports they applied for on behalf of a
    // child — a parent's "My Passport Applications" should show everything they submitted, not
    // just applications where they're the subject.
    const { rows } = await db.query(
      `SELECT pr.*, c.first_name AS subject_first_name, c.last_name AS subject_last_name
       FROM passport_records pr JOIN citizens c ON c.citizen_id = pr.citizen_id
       WHERE pr.citizen_id = $1 OR pr.applicant_citizen_id = $1 ORDER BY pr.created_at DESC`,
      [req.user.citizenId]
    );
    res.json({ passportRecords: rows });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    // Joins the citizen's own bio-data (name, sex, date/place of birth, permanent ID) — needed
    // to render the actual passport document (see pages/passport/PassportDocument.jsx), not just
    // the application's workflow status, which is all this used to return.
    const { rows } = await db.query(
      `SELECT pr.*, o.name AS collection_office_name,
              c.first_name, c.middle_name, c.last_name, c.sex, c.date_of_birth, c.place_of_birth, c.permanent_identity_number
       FROM passport_records pr
       LEFT JOIN offices o ON o.office_id = pr.collection_office_id
       JOIN citizens c ON c.citizen_id = pr.citizen_id
       WHERE pr.passport_record_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Passport application not found.' });
    const record = rows[0];
    // Two different people can legitimately own this application: the passport HOLDER
    // (citizen_id), or the parent who applied on their behalf (applicant_citizen_id) — same
    // dual-ownership rule the birth-certificate domain already uses.
    const isOwner = !!req.user.citizenId && (req.user.citizenId === record.citizen_id || req.user.citizenId === record.applicant_citizen_id);
    const isOfficer = ['passport_officer', 'system_administrator'].includes(req.user.roleKey);
    if (!isOwner && !isOfficer) return res.status(403).json({ error: 'You do not have access to this application.' });
    res.json({ passportRecord: record });
  } catch (err) {
    next(err);
  }
}

const TRANSITIONS = {
  'start-review': { from: 'Submitted', to: 'Under Review' },
  'verify-identity': { from: 'Under Review', to: 'Identity Verified' },
  'check-documents': { from: 'Identity Verified', to: 'Documents Checked' },
  'process': { from: 'Documents Checked', to: 'Processing' },
  'approve': { from: 'Processing', to: 'Approved' },
  'produce': { from: 'Approved', to: 'Passport Produced' },
  'ready-for-collection': { from: 'Passport Produced', to: 'Ready for Collection' },
  'collect': { from: 'Ready for Collection', to: 'Collected' },
};

async function transition(req, res, next) {
  try {
    if (!['passport_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const t = TRANSITIONS[req.params.action];
    if (!t) return res.status(400).json({ error: `Unknown action: ${req.params.action}` });
    // Collection (Feature 3): the citizen signs on a pad at the counter before the officer can
    // mark the passport collected — see database/migrations/035_add_signature_reference.sql.
    if (t.to === 'Collected' && !req.body.signatureReference) {
      return res.status(400).json({ error: 'The citizen\'s signature is required before the passport can be marked collected.' });
    }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM passport_records WHERE passport_record_id = $1 FOR UPDATE', [req.params.id]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
      const record = rows[0];
      if (record.status !== t.from) { await client.query('ROLLBACK'); return res.status(409).json({ error: `Cannot move from '${record.status}' to '${t.to}'.` }); }

      const passportNumber = t.to === 'Approved' ? 'P' + String(Math.floor(1000000 + Math.random() * 9000000)) : record.passport_number;
      const officeId = req.body.officeId || record.collection_office_id;
      await client.query(
        // $1 is cast explicitly everywhere it's used: it both SETs a varchar column and is
        // compared against text literals, and Postgres refuses to settle on one type for it
        // otherwise ("inconsistent types deduced for parameter $1") — the exact bug this same
        // pattern caused in the National ID workflow (see homeAffairs.controller.js).
        `UPDATE passport_records SET status = $1::varchar, passport_number = COALESCE($2, passport_number),
            issue_date = CASE WHEN $1::varchar = 'Approved' THEN CURRENT_DATE ELSE issue_date END,
            expiry_date = CASE WHEN $1::varchar = 'Approved' THEN CURRENT_DATE + INTERVAL '10 years' ELSE expiry_date END,
            collection_office_id = CASE WHEN $1::varchar = 'Ready for Collection' THEN $3 ELSE collection_office_id END,
            ready_for_collection_at = CASE WHEN $1::varchar = 'Ready for Collection' THEN NOW() ELSE ready_for_collection_at END,
            collected_at = CASE WHEN $1::varchar = 'Collected' THEN NOW() ELSE collected_at END,
            signature_reference = CASE WHEN $1::varchar = 'Collected' THEN $5 ELSE signature_reference END,
            updated_at = NOW()
         WHERE passport_record_id = $4`,
        [t.to, passportNumber, officeId, record.passport_record_id, req.body.signatureReference || null]
      );
      await syncApplicationStatus(client, { sourceTable: 'passport_records', sourceId: record.passport_record_id, status: t.to, completed: t.to === 'Collected' });
      await client.query('COMMIT');

      const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.applicant_citizen_id || record.citizen_id])).rows[0];
      if (userRow) {
        await createNotification({
          userId: userRow.user_id, title: `Passport application: ${t.to}`,
          message: t.to === 'Ready for Collection'
            ? `Your passport (${record.application_reference}) is ready for collection. Please bring your National ID card.`
            : `Your passport application (${record.application_reference}) status is now: ${t.to}.`,
          type: t.to === 'Ready for Collection' ? 'Ready for Collection' : t.to === 'Approved' ? 'Approval' : 'Status Change',
        });
      }
      res.json({ passportRecordId: record.passport_record_id, status: t.to, passportNumber });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

/** POST /api/passport/:id/resubmit (citizen, owner only) — Feature 4: lets the citizen correct
 *  and resubmit after Additional Information Required or Rejected, instead of starting a new
 *  application. Built from scratch — passport had no resubmit concept before this. */
async function resubmit(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required.' });
    const { passportType, preferredOfficeId, photoReference, paymentReference, receiptImageReference } = req.body;
    if (!preferredOfficeId) {
      return res.status(400).json({ error: 'preferredOfficeId is required — choose the branch where you will collect the passport.' });
    }
    if (!paymentReference || !receiptImageReference) {
      return res.status(400).json({ error: 'paymentReference and receiptImageReference are required.' });
    }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM passport_records WHERE passport_record_id = $1 FOR UPDATE', [req.params.id]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
      const record = rows[0];
      if (record.citizen_id !== req.user.citizenId && record.applicant_citizen_id !== req.user.citizenId) {
        await client.query('ROLLBACK'); return res.status(403).json({ error: 'Not your application.' });
      }
      if (!['Additional Information Required', 'Rejected'].includes(record.status)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Cannot resubmit from '${record.status}'.` });
      }
      await client.query(
        `UPDATE passport_records SET status = 'Under Review', rejection_reason = NULL,
            passport_type = $1, preferred_office_id = $2, photo_reference = $3, payment_reference = $4, receipt_image_reference = $5, updated_at = NOW()
         WHERE passport_record_id = $6`,
        [passportType || record.passport_type, preferredOfficeId, photoReference || record.photo_reference, paymentReference, receiptImageReference, record.passport_record_id]
      );
      await syncApplicationStatus(client, { sourceTable: 'passport_records', sourceId: record.passport_record_id, status: 'Under Review' });
      await client.query('COMMIT');
      const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.applicant_citizen_id || record.citizen_id])).rows[0];
      if (userRow) {
        await createNotification({ userId: userRow.user_id, title: 'Passport application resubmitted', message: `Reference ${record.application_reference} has been resubmitted and is under review.`, type: 'Status Change' });
      }
      res.json({ passportRecordId: record.passport_record_id, status: 'Under Review' });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

/** POST /api/passport/:id/request-information body:{reason} — Additional Information Required */
async function requestInformation(req, res, next) {
  try {
    if (!['passport_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'A reason is required.' });
    const { rows } = await db.query(
      `UPDATE passport_records SET status = 'Additional Information Required', updated_at = NOW()
       WHERE passport_record_id = $1 AND status NOT IN ('Rejected','Collected') RETURNING *`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Cannot request information in the current state.' });
    await syncApplicationStatus(db, { sourceTable: 'passport_records', sourceId: Number(req.params.id), status: 'Additional Information Required' });
    const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [rows[0].applicant_citizen_id || rows[0].citizen_id])).rows[0];
    if (userRow) await createNotification({ userId: userRow.user_id, title: 'Additional information required', message: reason, type: 'Missing Information' });
    res.json({ passportRecord: rows[0] });
  } catch (err) {
    next(err);
  }
}

/** POST /api/passport/:id/reject body:{reason} */
async function reject(req, res, next) {
  try {
    if (!['passport_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'A reason is required.' });
    const { rows } = await db.query(
      `UPDATE passport_records SET status = 'Rejected', rejection_reason = $1, updated_at = NOW()
       WHERE passport_record_id = $2 AND status NOT IN ('Rejected','Collected') RETURNING *`,
      [reason, req.params.id]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Cannot reject in the current state.' });
    await syncApplicationStatus(db, { sourceTable: 'passport_records', sourceId: Number(req.params.id), status: 'Rejected', completed: true });
    const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [rows[0].applicant_citizen_id || rows[0].citizen_id])).rows[0];
    if (userRow) await createNotification({ userId: userRow.user_id, title: 'Passport application rejected', message: reason, type: 'Rejection' });
    await recordAudit({ userId: req.user.userId, departmentId: await getDepartmentId('passport'), action: 'PASSPORT_REJECTED', targetType: 'passport_record', targetId: Number(req.params.id), reason });
    res.json({ passportRecord: rows[0] });
  } catch (err) {
    next(err);
  }
}

module.exports = { getEligibility, apply, applyRenewal, applyReplacement, list, getOne, transition, requestInformation, reject, resubmit };
