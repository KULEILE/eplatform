const db = require('../config/db');
const { withUniquePermanentId } = require('../utils/idGenerator');
const { generateReference } = require('../utils/referenceGenerator');
const { indexApplication, syncApplicationStatus, getDepartmentId } = require('../utils/lookup');
const { createNotification } = require('../utils/notify');
const { recordAudit } = require('../utils/audit');
const { isValidTemplate } = require('../utils/handMatch');

// ============================================================================================
// BIRTH REGISTRATION — now fully automatic. A NEW application is checked and either approved
// (the certificate is generated in the same step) or rejected (with a clear reason) the moment
// it is submitted — there is no officer review queue for it any more. See migration 059.
//
// The old manual registration_status flow below is left in place and still works for any
// application that was already sitting in one of these states before that migration — it is
// simply never reached by a new submission going forward:
//   Draft -> Submitted -> Under Review -> [Information Required -> Under Review]
//         -> Verification in Progress -> Verified -> Approved
//                                                  \-> Rejected (from any non-terminal state)
// ============================================================================================

// A parent slot can be fully "Present" (the default — unchanged from before: name, citizenship,
// and ID-or-passport all required and verified) or carry one of these declared statuses instead,
// each with its own, deliberately looser requirements — see resolveParentDetails below:
//   Unknown   — nothing at all is required or stored.
//   Absent    — a plain, unverified name only; no ID, no passport, nothing cross-checked.
//   Inactive  — a real citizen with no reachable portal account: name + identity number
//               required, and it must match a real, living citizen (same verification as
//               "Present"), but this parent is never asked to confirm/dispute through the portal.
//   Deceased  — name required; identity number optional. If given, it must match a real citizen
//               AND that citizen must actually be recorded as deceased. This also fixes a real
//               bug: a parent's death used to auto-reject the WHOLE application outright, which
//               is wrong — a parent dying is normal and must never block a child's birth
//               certificate.
const PARENT_DECLARED_STATUSES = ['Unknown', 'Absent', 'Inactive', 'Deceased'];

// A parent must be at least this many years older than the child they're being named on — a
// safeguard of this system's own (not an official Home Affairs rule), catching an impossible or
// nonsensical age gap (e.g. registering a "child" older than, or only a few years younger than,
// the person named as their parent). Only checked when the named parent resolved to a real
// citizen record we actually have a date of birth for (a plain "Absent"/"Unknown" declaration, or
// a non-citizen with only a passport on file, can't be checked this way and is left as-is).
const MIN_PARENT_AGE_GAP_YEARS = 12;

function violatesMinParentAgeGap(parentDateOfBirth, childDateOfBirth) {
  if (!parentDateOfBirth || !childDateOfBirth) return false;
  const minChildDate = new Date(parentDateOfBirth);
  minChildDate.setUTCFullYear(minChildDate.getUTCFullYear() + MIN_PARENT_AGE_GAP_YEARS);
  return new Date(childDateOfBirth) < minChildDate;
}

function validateDeclaredStatus(label, declaredStatus) {
  if (declaredStatus === undefined || declaredStatus === null || declaredStatus === '') return null;
  if (!PARENT_DECLARED_STATUSES.includes(declaredStatus)) {
    throw Object.assign(new Error(`${label}DeclaredStatus must be one of ${PARENT_DECLARED_STATUSES.join(', ')}.`), { status: 400 });
  }
  return declaredStatus;
}

async function resolveParentDetails(client, { label, name, isCitizen, identityNumber, passportNumber, passportImageReference, declaredStatus }) {
  const missing = [];
  const rejections = [];
  const stored = { name: null, isCitizen: null, identityNumber: null, citizenId: null, passportNumber: null, passportImageReference: null, dateOfBirth: null };

  if (declaredStatus === 'Unknown') {
    // Nothing is known about this parent at all — nothing required, nothing stored.
  } else if (declaredStatus === 'Absent') {
    stored.name = name || null;
  } else if (declaredStatus === 'Inactive' || declaredStatus === 'Deceased') {
    if (!name) missing.push(`${label}Name`);
    if (declaredStatus === 'Inactive' && !identityNumber) missing.push(`${label}IdentityNumber`);
    stored.name = name || null;
    if (name && identityNumber) {
      const { rows } = await client.query('SELECT citizen_id, is_deceased, date_of_birth FROM citizens WHERE permanent_identity_number = $1', [identityNumber]);
      if (rows.length === 0) {
        rejections.push(`The ${label}'s permanent identity number does not match any record at Home Affairs.`);
      } else if (declaredStatus === 'Deceased' && !rows[0].is_deceased) {
        rejections.push(`The ${label}'s identity record is not recorded as deceased at Home Affairs — check the number, or choose a different status.`);
      } else if (declaredStatus === 'Inactive' && rows[0].is_deceased) {
        rejections.push(`The ${label}'s identity record is recorded as deceased — choose "Deceased" instead of "Inactive" for this parent.`);
      } else {
        stored.citizenId = rows[0].citizen_id;
        stored.isCitizen = true;
        stored.identityNumber = identityNumber;
        stored.dateOfBirth = rows[0].date_of_birth;
      }
    }
    // Deceased with no identity number given at all: the declaration is taken at face value —
    // nothing to check, nothing rejected.
  } else {
    // Default / "Present" — unchanged from before this batch.
    if (!name) missing.push(`${label}Name`);
    if (typeof isCitizen !== 'boolean') missing.push(`${label}IsCitizen`);
    if (isCitizen && !identityNumber) missing.push(`${label}IdentityNumber`);
    if (isCitizen === false && (!passportNumber || !passportImageReference)) missing.push(`${label}PassportNumber/${label}PassportImageReference`);
    stored.name = name || null;
    stored.isCitizen = typeof isCitizen === 'boolean' ? isCitizen : null;
    if (isCitizen && identityNumber) {
      const { rows } = await client.query('SELECT citizen_id, is_deceased, date_of_birth FROM citizens WHERE permanent_identity_number = $1', [identityNumber]);
      if (rows.length === 0) {
        rejections.push(`The ${label}'s permanent identity number does not match any record at Home Affairs.`);
      } else if (rows[0].is_deceased) {
        rejections.push(`The ${label}'s identity record is recorded as deceased — if that's correct, mark this parent as "Deceased" instead.`);
      } else {
        stored.citizenId = rows[0].citizen_id;
        stored.identityNumber = identityNumber;
        stored.dateOfBirth = rows[0].date_of_birth;
      }
    } else if (isCitizen === false) {
      stored.passportNumber = passportNumber || null;
      stored.passportImageReference = passportImageReference || null;
    }
  }
  return { missing, rejections, stored };
}

/**
 * Shared by createBirthRegistration (a logged-in parent/guardian registering their child) and
 * applyForBirthCertificatePublic (an adult with no account at all applying for their OWN birth
 * certificate, as the very first step of getting one — see Register.jsx). Both collect the same
 * information and are checked the same way: each parent is either "Present" (a Lesotho citizen
 * whose permanent identity number is looked up and must match our records, or a non-citizen with
 * a passport number + photo recorded instead) or carries one of the declared statuses above.
 * Nothing here can check whether an uploaded chief's letter genuinely carries the chief's stamp —
 * that is a real limitation of an automatic, officer-free process, not something invented away;
 * the caller is responsible for showing the citizen a clear instruction about it before they
 * upload (see the frontend form).
 *
 * Batch 4 adds the one core anti-fraud control this process was missing: when a logged-in parent
 * is registering a child (submittingParentCitizenId set, isSelfApplication false), their OWN
 * identity number must match one of the two named parents — otherwise anyone with an account
 * could name two real citizens as a child's parents with no connection to either of them. This
 * does not apply to a self-application, which has no "claiming to be someone's parent" fraud
 * vector in the same sense.
 *
 * Returns { approved, birthRecordId, referenceNumber, rejectionReason } when rejected, or
 * { approved: true, birthRecordId, referenceNumber, citizenId, permanentIdentityNumber,
 *   certificateNumber, birthCertificateId, fatherCitizenId, motherCitizenId,
 *   fatherConfirmationStatus, motherConfirmationStatus }
 * when approved. Runs inside the caller's own transaction (does not BEGIN/COMMIT itself) so the
 * caller can add its own notification/audit entries atomically around it.
 */
async function processBirthCertificateApplication(client, fields) {
  const {
    childFirstName, childMiddleName, childLastName, dateOfBirth, placeOfBirth, sex, preferredOfficeId,
    fatherName, fatherNationality, fatherIsCitizen, fatherIdentityNumber, fatherPassportNumber, fatherPassportImageReference, fatherDeclaredStatus,
    motherName, motherMaidenSurname, motherNationality, motherResidence, motherIsCitizen, motherIdentityNumber, motherPassportNumber, motherPassportImageReference, motherDeclaredStatus,
    chiefLetterImageReference, proofOfBirthImageReference, marriageCertificateImageReference, acknowledgementOfPaternityImageReference,
    submittingParentCitizenId, isSelfApplication,
  } = fields;

  const fatherDeclared = validateDeclaredStatus('father', fatherDeclaredStatus);
  const motherDeclared = validateDeclaredStatus('mother', motherDeclaredStatus);

  const fatherResolved = await resolveParentDetails(client, {
    label: 'father', name: fatherName, isCitizen: fatherIsCitizen, identityNumber: fatherIdentityNumber,
    passportNumber: fatherPassportNumber, passportImageReference: fatherPassportImageReference, declaredStatus: fatherDeclared,
  });
  const motherResolved = await resolveParentDetails(client, {
    label: 'mother', name: motherName, isCitizen: motherIsCitizen, identityNumber: motherIdentityNumber,
    passportNumber: motherPassportNumber, passportImageReference: motherPassportImageReference, declaredStatus: motherDeclared,
  });

  const missing = [];
  if (!childFirstName) missing.push('childFirstName');
  if (!childLastName) missing.push('childLastName');
  if (!dateOfBirth) missing.push('dateOfBirth');
  if (!placeOfBirth) missing.push('placeOfBirth');
  if (!sex) missing.push('sex');
  // Choosing a collection branch needs the district/office list, which is an authenticated
  // endpoint (see offices.routes.js) — out of reach for a public, not-logged-in self-applicant.
  // So this is only required when a logged-in parent is registering a child; a self-application
  // simply leaves birth_certificates.collection_office_id null (nullable — see migration 006),
  // and that citizen picks a branch the normal way once they've created and logged into their
  // account.
  if (!isSelfApplication && !preferredOfficeId) missing.push('preferredOfficeId');
  if (!chiefLetterImageReference) missing.push('chiefLetterImageReference');
  if (!proofOfBirthImageReference) missing.push('proofOfBirthImageReference');
  missing.push(...fatherResolved.missing, ...motherResolved.missing);
  if (missing.length > 0) {
    throw Object.assign(new Error(`The following are required: ${missing.join(', ')}.`), { status: 400 });
  }

  const fatherCitizenId = fatherResolved.stored.citizenId;
  const motherCitizenId = motherResolved.stored.citizenId;
  const rejectionReasons = [...fatherResolved.rejections, ...motherResolved.rejections];

  // Not an official Home Affairs rule — a safeguard of this system's own, so an application
  // cannot be auto-approved from two unverifiable/unidentifiable claims with nothing behind them.
  if (!fatherCitizenId && !motherCitizenId) {
    rejectionReasons.push('At least one parent must be a Lesotho citizen whose permanent identity number matches our records.');
  }

  // Another safeguard of this system's own: a named parent we actually have a date of birth for
  // must be at least MIN_PARENT_AGE_GAP_YEARS years older than the child — otherwise the two
  // records plainly can't describe a real parent/child relationship.
  if (violatesMinParentAgeGap(fatherResolved.stored.dateOfBirth, dateOfBirth)) {
    rejectionReasons.push(`The father's date of birth on record is not consistent with being this child's parent (must be at least ${MIN_PARENT_AGE_GAP_YEARS} years older).`);
  }
  if (violatesMinParentAgeGap(motherResolved.stored.dateOfBirth, dateOfBirth)) {
    rejectionReasons.push(`The mother's date of birth on record is not consistent with being this child's parent (must be at least ${MIN_PARENT_AGE_GAP_YEARS} years older).`);
  }

  // The core anti-fraud control: a logged-in parent registering a child must themselves be one
  // of the two named parents.
  let submitterIsFather = false;
  let submitterIsMother = false;
  if (!isSelfApplication && submittingParentCitizenId) {
    submitterIsFather = fatherCitizenId === submittingParentCitizenId;
    submitterIsMother = motherCitizenId === submittingParentCitizenId;
    if (!submitterIsFather && !submitterIsMother) {
      rejectionReasons.push("You must be one of this child's two named parents to register this birth — your own identity number did not match either parent you named.");
    }
    if (submitterIsFather && fatherDeclared) {
      rejectionReasons.push("The father can't be marked Unknown/Absent/Inactive/Deceased while you are registering this birth as the father yourself.");
    }
    if (submitterIsMother && motherDeclared) {
      rejectionReasons.push("The mother can't be marked Unknown/Absent/Inactive/Deceased while you are registering this birth as the mother yourself.");
    }
  }

  const referenceNumber = generateReference('BR');
  const approved = rejectionReasons.length === 0;

  // Each named parent who (a) resolved to a real citizen record, (b) has no declared status
  // (Unknown/Absent/Inactive/Deceased are excluded from confirmation entirely — there's no
  // account to reach, or nothing to confirm), and (c) is not the submitter themselves (a
  // submitting parent already attests to their own involvement just by submitting this) gets a
  // non-blocking, after-the-fact chance to confirm or dispute being named — see migration 061/062
  // and confirmParentage/disputeParentage below. A parent-submitted registration only ever leaves
  // the OTHER parent pending (the submitter is excluded); a self-application (migration 059) has
  // no submitting parent at all — the applicant IS the child, not either parent — so BOTH named
  // parents are eligible. Only computed for an approved application.
  let fatherConfirmationStatus = 'Not Applicable';
  let motherConfirmationStatus = 'Not Applicable';
  if (approved) {
    const fatherIsSubmitter = !isSelfApplication && submitterIsFather;
    const motherIsSubmitter = !isSelfApplication && submitterIsMother;
    if (fatherCitizenId && !fatherDeclared && !fatherIsSubmitter) fatherConfirmationStatus = 'Pending';
    if (motherCitizenId && !motherDeclared && !motherIsSubmitter) motherConfirmationStatus = 'Pending';
  }

  const { rows: inserted } = await client.query(
    `INSERT INTO birth_records (
        parent_citizen_id, is_self_application, registration_reference,
        child_first_name, child_middle_name, child_last_name, date_of_birth, place_of_birth, sex,
        father_name, father_nationality, father_is_citizen, father_identity_number, father_citizen_id, father_passport_number, father_passport_image_reference, father_declared_status,
        mother_name, mother_maiden_surname, mother_nationality, mother_residence, mother_is_citizen, mother_identity_number, mother_citizen_id, mother_passport_number, mother_passport_image_reference, mother_declared_status,
        chief_letter_image_reference, proof_of_birth_image_reference, marriage_certificate_image_reference, acknowledgement_of_paternity_image_reference,
        preferred_office_id, registration_status, rejection_reason, submitted_at, approved_at,
        father_confirmation_status, mother_confirmation_status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,NOW(),$35,$36,$37)
     RETURNING *`,
    [submittingParentCitizenId || null, !!isSelfApplication, referenceNumber,
     childFirstName, childMiddleName || null, childLastName, dateOfBirth, placeOfBirth, sex,
     fatherResolved.stored.name, fatherNationality || 'Mosotho', fatherResolved.stored.isCitizen, fatherResolved.stored.identityNumber, fatherCitizenId,
     fatherResolved.stored.passportNumber, fatherResolved.stored.passportImageReference, fatherDeclared,
     motherResolved.stored.name, motherMaidenSurname || null, motherNationality || 'Mosotho', motherResidence || null, motherResolved.stored.isCitizen,
     motherResolved.stored.identityNumber, motherCitizenId, motherResolved.stored.passportNumber, motherResolved.stored.passportImageReference, motherDeclared,
     chiefLetterImageReference, proofOfBirthImageReference, marriageCertificateImageReference || null, acknowledgementOfPaternityImageReference || null,
     preferredOfficeId || null, approved ? 'Approved' : 'Rejected', approved ? null : rejectionReasons.join(' '), approved ? new Date() : null,
     fatherConfirmationStatus, motherConfirmationStatus]
  );
  const record = inserted[0];

  // applications.citizen_id is NOT NULL — it can only be indexed against a citizen who already
  // exists. A logged-in parent/guardian always has one (submittingParentCitizenId), so that case
  // is indexed immediately, same as before. A self-application (migration 059) has none at
  // submission time: if it's approved, one is created just below and indexed then instead; if
  // it's rejected, no citizen is ever created for it, so there is nothing to index against — the
  // rejected self-application still exists as a birth_records row (visible to officers via
  // listBirthRegistrations), it just doesn't appear in the generic /applications tracker.
  if (submittingParentCitizenId) {
    await indexApplication(client, {
      citizenId: submittingParentCitizenId, departmentKey: 'home_affairs', serviceType: 'Birth Registration',
      referenceNumber, sourceTable: 'birth_records', sourceId: record.birth_record_id, status: approved ? 'Approved' : 'Rejected',
    });
  }

  if (!approved) {
    return { approved: false, birthRecordId: record.birth_record_id, referenceNumber, rejectionReason: record.rejection_reason };
  }

  // Approved — create the new citizen identity and the certificate immediately, the same way
  // the old manual approveBirthRegistration() used to (see further down this file for the
  // officer-driven version, still used by any pre-existing application in 'Verified' status).
  const citizenId = await withUniquePermanentId(dateOfBirth, async (candidatePin) => {
    const { rows } = await client.query(
      `INSERT INTO citizens (permanent_identity_number, first_name, middle_name, last_name,
          date_of_birth, place_of_birth, sex, citizenship_status, identity_verification_status,
          parent_citizen_id, is_demo_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Citizen','Verified',$8,TRUE) RETURNING citizen_id, permanent_identity_number`,
      [candidatePin, childFirstName, childMiddleName || null, childLastName, dateOfBirth, placeOfBirth, sex, submittingParentCitizenId || null]
    );
    return rows[0];
  });

  await client.query('UPDATE birth_records SET citizen_id = $1, updated_at = NOW() WHERE birth_record_id = $2', [citizenId.citizen_id, record.birth_record_id]);

  // The self-application case deferred from above — the citizen now exists, so index it here.
  if (!submittingParentCitizenId) {
    await indexApplication(client, {
      citizenId: citizenId.citizen_id, departmentKey: 'home_affairs', serviceType: 'Birth Registration',
      referenceNumber, sourceTable: 'birth_records', sourceId: record.birth_record_id, status: 'Approved',
    });
  }

  const certificateNumber = generateReference('BC');
  const { rows: certRows } = await client.query(
    `INSERT INTO birth_certificates (citizen_id, birth_record_id, certificate_number, issue_date, status, collection_office_id)
     VALUES ($1,$2,$3, CURRENT_DATE, 'Certificate Generated', $4) RETURNING birth_certificate_id`,
    [citizenId.citizen_id, record.birth_record_id, certificateNumber, preferredOfficeId || null]
  );

  return {
    approved: true, birthRecordId: record.birth_record_id, referenceNumber,
    citizenId: citizenId.citizen_id, permanentIdentityNumber: citizenId.permanent_identity_number,
    certificateNumber, birthCertificateId: certRows[0].birth_certificate_id,
    fatherCitizenId: record.father_citizen_id, motherCitizenId: record.mother_citizen_id,
    fatherConfirmationStatus: record.father_confirmation_status, motherConfirmationStatus: record.mother_confirmation_status,
  };
}

/** POST /api/home-affairs/birth-registration — parent/guardian submits (citizen only). */
async function createBirthRegistration(req, res, next) {
  try {
    if (!req.user.citizenId) {
      return res.status(403).json({ error: 'A verified identity is required to register a birth.' });
    }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const result = await processBirthCertificateApplication(client, { ...req.body, submittingParentCitizenId: req.user.citizenId, isSelfApplication: false });
      await client.query('COMMIT');

      if (result.approved) {
        await createNotification({
          userId: req.user.userId, title: 'Birth registration approved',
          message: `Birth registration ${result.referenceNumber} has been approved. A birth certificate (${result.certificateNumber}) has been generated.`,
          type: 'Approval',
        });
        await recordAudit({
          userId: req.user.userId, departmentId: await getDepartmentId('home_affairs'), action: 'BIRTH_REGISTRATION_APPROVED',
          targetType: 'birth_record', targetId: result.birthRecordId, metadata: { citizenId: result.citizenId, certificateNumber: result.certificateNumber },
        });
        // Any named parent left Pending (the other parent, not the submitter — see
        // processBirthCertificateApplication) who is a real citizen reachable through their own
        // account gets notified they can review and confirm/dispute this registration — see
        // confirmParentage/disputeParentage below. This never blocks or delays the certificate,
        // which has already been issued above either way.
        const pendingParentIds = [];
        if (result.fatherConfirmationStatus === 'Pending' && result.fatherCitizenId) pendingParentIds.push(result.fatherCitizenId);
        if (result.motherConfirmationStatus === 'Pending' && result.motherCitizenId) pendingParentIds.push(result.motherCitizenId);
        for (const pendingCitizenId of pendingParentIds) {
          const { rows: otherUserRows } = await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [pendingCitizenId]);
          if (otherUserRows[0]) {
            await createNotification({
              userId: otherUserRows[0].user_id, title: 'You were named as a parent on a birth registration',
              message: `Birth registration ${result.referenceNumber} names you as a parent. Please review and confirm or dispute it in your account.`,
              type: 'Verification',
            });
          }
        }
        return res.status(201).json({ birthRecordId: result.birthRecordId, referenceNumber: result.referenceNumber, status: 'Approved', citizenId: result.citizenId, permanentIdentityNumber: result.permanentIdentityNumber, certificateNumber: result.certificateNumber });
      }
      await createNotification({
        userId: req.user.userId, title: 'Birth registration could not be approved',
        message: `Reference ${result.referenceNumber}: ${result.rejectionReason}`,
        type: 'Rejection',
      });
      return res.status(201).json({ birthRecordId: result.birthRecordId, referenceNumber: result.referenceNumber, status: 'Rejected', rejectionReason: result.rejectionReason });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/birth-certificate-applications — PUBLIC, no login required. For an adult with no
 * matching citizen record at all, applying for their OWN birth certificate as the first step
 * toward getting an account (see Register.jsx: once this succeeds, they come back and type the
 * new permanent identity number it returns into "I already have one", and that account gets
 * created and verified automatically — the same way any already-registered citizen's does).
 *
 * A birth certificate never expires and is never renewed — once someone's identity exists here,
 * no new one can be created for them through this form; attachUserIfPresent (see that router)
 * lets this still-public endpoint notice when the caller happens to be logged in and already
 * has one, so it can refuse and point them at a certificate reissue instead of silently minting
 * a second identity for the same person.
 */
async function applyForBirthCertificatePublic(req, res, next) {
  if (req.user && req.user.citizenId) {
    return res.status(409).json({
      error: 'You already have a verified identity and birth certificate. A birth certificate cannot be applied for again — if you need a replacement copy, request a certificate reissue instead.',
      alreadyVerified: true,
    });
  }
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await processBirthCertificateApplication(client, {
      ...req.body,
      // childFirstName/childMiddleName/childLastName/dateOfBirth/placeOfBirth/sex here describe
      // the APPLICANT themselves, not a baby — same fields, different meaning, since the shared
      // function only ever creates one new citizen record either way.
      submittingParentCitizenId: null, isSelfApplication: true,
    });
    await client.query('COMMIT');
    if (result.approved) {
      // There is no "submitter" here to exclude — the applicant IS the child, not either parent
      // — so BOTH named parents can be left Pending by processBirthCertificateApplication. Each
      // one who is a real citizen reachable through their own account gets notified they can
      // review and confirm/dispute being named, exactly as a parent-submitted registration does
      // in createBirthRegistration above. This was previously missing entirely for this form.
      const pendingParentIds = [];
      if (result.fatherConfirmationStatus === 'Pending' && result.fatherCitizenId) pendingParentIds.push(result.fatherCitizenId);
      if (result.motherConfirmationStatus === 'Pending' && result.motherCitizenId) pendingParentIds.push(result.motherCitizenId);
      for (const pendingCitizenId of pendingParentIds) {
        const { rows: parentUserRows } = await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [pendingCitizenId]);
        if (parentUserRows[0]) {
          await createNotification({
            userId: parentUserRows[0].user_id, title: 'You were named as a parent on a birth certificate application',
            message: `A birth certificate self-application (${result.referenceNumber}) names you as a parent. Please review and confirm or dispute it in your account.`,
            type: 'Verification',
          });
        }
      }
      return res.status(201).json({
        referenceNumber: result.referenceNumber, status: 'Approved',
        permanentIdentityNumber: result.permanentIdentityNumber, certificateNumber: result.certificateNumber,
      });
    }
    return res.status(201).json({ referenceNumber: result.referenceNumber, status: 'Rejected', rejectionReason: result.rejectionReason });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

/** GET /api/home-affairs/birth-registration — citizen: own applications. Officer: queue (optionally ?status=). */
async function listBirthRegistrations(req, res, next) {
  try {
    if (req.user.roleKey === 'home_affairs_officer' || req.user.roleKey === 'system_administrator') {
      const { status } = req.query;
      const { rows } = await db.query(
        // LEFT JOIN — a self-application (see migration 059) has no submitting parent at all,
        // so parent_citizen_id is NULL; parent_first_name/parent_last_name just come back NULL
        // for those rows instead of the row being silently dropped from an officer's queue.
        `SELECT br.*, c.first_name AS parent_first_name, c.last_name AS parent_last_name,
                c.permanent_identity_number AS parent_permanent_identity_number
         FROM birth_records br LEFT JOIN citizens c ON c.citizen_id = br.parent_citizen_id
         WHERE $1::text IS NULL OR br.registration_status = $1
         ORDER BY br.submitted_at DESC NULLS LAST`,
        [status || null]
      );
      return res.json({ birthRegistrations: rows });
    }
    if (!req.user.citizenId) return res.json({ birthRegistrations: [] });
    const { rows } = await db.query(
      // OR citizen_id = $1 — picks up this citizen's OWN self-application (migration 059), which
      // has no submitting parent at all (parent_citizen_id NULL) but did create this citizen_id.
      `SELECT * FROM birth_records WHERE parent_citizen_id = $1 OR citizen_id = $1 ORDER BY submitted_at DESC NULLS LAST`,
      [req.user.citizenId]
    );
    res.json({ birthRegistrations: rows });
  } catch (err) {
    next(err);
  }
}

/** GET /api/home-affairs/birth-registration/:id */
async function getBirthRegistration(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT br.*, bc.birth_certificate_id, bc.certificate_number, bc.status AS certificate_status,
              o.name AS preferred_office_name, dist.name AS preferred_office_district
       FROM birth_records br LEFT JOIN birth_certificates bc ON bc.birth_record_id = br.birth_record_id
       LEFT JOIN offices o ON o.office_id = br.preferred_office_id
       LEFT JOIN districts dist ON dist.district_id = o.district_id
       WHERE br.birth_record_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Birth registration not found.' });
    const record = rows[0];
    // A self-application (migration 059 — someone with no account applying for their own birth
    // certificate) has no submitting parent, so parent_citizen_id is null for it; once that
    // applicant has created and logged into their own account, they own this record through
    // citizen_id instead (the identity it created), not parent_citizen_id.
    const isOwner = !!req.user.citizenId && (record.parent_citizen_id === req.user.citizenId || record.citizen_id === req.user.citizenId);
    const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey);
    if (!isOwner && !isOfficer) return res.status(403).json({ error: 'You do not have access to this application.' });
    res.json({ birthRegistration: record });
  } catch (err) {
    next(err);
  }
}

// ============================================================================================
// PARENTAGE CONFIRMATION / DISPUTE — the non-blocking "sign to verify" second truth layer for a
// birth registration (see migration 061 and processBirthCertificateApplication above). The
// certificate is always issued instantly regardless; this only settles afterwards whether the
// other named parent agrees they were correctly named. A dispute is the ONE place anywhere in
// the birth-certificate domain (registration, self-application, reissue are all fully automatic)
// where a Home Affairs officer is ever involved.
// ============================================================================================

// Which parent slot (if any) this citizen was named in on this birth record — 'father', 'mother',
// or null if they weren't named as either. Used by confirmParentage/disputeParentage below to
// work out which pair of columns applies, since either or both slots can independently be
// Pending/Disputed per migration 062.
function resolveParentRoleForCitizen(record, citizenId) {
  if (!citizenId) return null;
  if (record.father_citizen_id === citizenId) return 'father';
  if (record.mother_citizen_id === citizenId) return 'mother';
  return null;
}

/** GET /api/home-affairs/birth-registration/pending-confirmations */
async function listPendingParentConfirmations(req, res, next) {
  try {
    if (!req.user.citizenId) return res.json({ pendingConfirmations: [] });
    const { rows } = await db.query(
      `SELECT br.birth_record_id, br.registration_reference, br.child_first_name, br.child_last_name,
              CASE WHEN br.father_citizen_id = $1 THEN 'father' ELSE 'mother' END AS parent_role,
              CASE WHEN br.father_citizen_id = $1 THEN br.father_confirmation_status ELSE br.mother_confirmation_status END AS confirmation_status,
              p.first_name AS submitted_by_first_name, p.last_name AS submitted_by_last_name
       FROM birth_records br
       LEFT JOIN citizens p ON p.citizen_id = br.parent_citizen_id
       WHERE (br.father_citizen_id = $1 AND br.father_confirmation_status = 'Pending')
          OR (br.mother_citizen_id = $1 AND br.mother_confirmation_status = 'Pending')
       ORDER BY br.created_at DESC`,
      [req.user.citizenId]
    );
    res.json({ pendingConfirmations: rows });
  } catch (err) { next(err); }
}

/** POST /api/home-affairs/birth-registration/:id/confirm-parentage  body: { signatureReference } */
async function confirmParentage(req, res, next) {
  try {
    const { signatureReference } = req.body;
    if (!signatureReference) return res.status(400).json({ error: 'A signature is required to confirm.' });
    const { rows } = await db.query('SELECT * FROM birth_records WHERE birth_record_id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Birth record not found.' });
    const record = rows[0];
    const role = resolveParentRoleForCitizen(record, req.user.citizenId);
    if (!role) return res.status(403).json({ error: 'You were not named as a parent on this registration.' });
    const statusCol = `${role}_confirmation_status`;
    if (record[statusCol] !== 'Pending') return res.status(409).json({ error: `This confirmation is no longer pending (status: ${record[statusCol]}).` });
    await db.query(
      `UPDATE birth_records SET ${role}_confirmation_status = 'Confirmed', ${role}_confirmed_at = NOW(),
              ${role}_confirmation_signature_reference = $1, updated_at = NOW() WHERE birth_record_id = $2`,
      [signatureReference, record.birth_record_id]
    );
    const { rows: submitterUserRows } = await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.parent_citizen_id]);
    if (submitterUserRows[0]) {
      await createNotification({
        userId: submitterUserRows[0].user_id, title: 'Parentage confirmed',
        message: `The ${role} named on birth registration ${record.registration_reference} has confirmed it.`,
        type: 'Status Change',
      });
    }
    res.json({ birthRecordId: record.birth_record_id, role, status: 'Confirmed' });
  } catch (err) { next(err); }
}

/** POST /api/home-affairs/birth-registration/:id/dispute-parentage  body: { reason } */
async function disputeParentage(req, res, next) {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'A reason is required to dispute this.' });
    const { rows } = await db.query('SELECT * FROM birth_records WHERE birth_record_id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Birth record not found.' });
    const record = rows[0];
    const role = resolveParentRoleForCitizen(record, req.user.citizenId);
    if (!role) return res.status(403).json({ error: 'You were not named as a parent on this registration.' });
    const statusCol = `${role}_confirmation_status`;
    if (record[statusCol] !== 'Pending') return res.status(409).json({ error: `This confirmation is no longer pending (status: ${record[statusCol]}).` });
    await db.query(
      `UPDATE birth_records SET ${role}_confirmation_status = 'Disputed', ${role}_dispute_reason = $1, updated_at = NOW() WHERE birth_record_id = $2`,
      [reason, record.birth_record_id]
    );
    const { rows: submitterUserRows } = await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.parent_citizen_id]);
    if (submitterUserRows[0]) {
      await createNotification({
        userId: submitterUserRows[0].user_id, title: 'Parentage disputed',
        message: `The ${role} named on birth registration ${record.registration_reference} has disputed it. A Home Affairs officer will review this.`,
        type: 'Status Change',
      });
    }
    await recordAudit({
      userId: req.user.userId, departmentId: await getDepartmentId('home_affairs'), action: 'PARENTAGE_DISPUTED',
      targetType: 'birth_record', targetId: record.birth_record_id, reason, metadata: { role },
    });
    res.json({ birthRecordId: record.birth_record_id, role, status: 'Disputed' });
  } catch (err) { next(err); }
}

/** GET /api/home-affairs/parentage-disputes — officer-only queue. One row per disputed-or-
 * awaiting-correction PARENT SLOT, not per birth record — if both the father and mother slots are
 * independently disputed on the same record (rare, but possible since migration 062 made the two
 * slots fully independent), both appear as separate rows so an officer can act on each on its own
 * merits. Covers two stages: 'Disputed' (needs resolveParentageDispute — Dismiss or Uphold) and
 * 'Dispute Upheld' (already cleared; now needs correctParentageDispute once the applicant and the
 * disputing parent have come in and discussed it — see that function's notification). A row that
 * named_parent_first_name is null for was already cleared by an upheld dispute, so there's no
 * named person left to show until the correction is entered. */
async function listParentageDisputes(req, res, next) {
  try {
    if (!['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey)) {
      return res.status(403).json({ error: 'Officer only.' });
    }
    const { rows } = await db.query(
      `SELECT br.birth_record_id, br.registration_reference, br.child_first_name, br.child_last_name,
              'father' AS disputed_role, br.father_confirmation_status AS confirmation_status, br.father_dispute_reason AS dispute_reason, br.updated_at,
              c.first_name AS child_first_name_full, c.last_name AS child_last_name_full,
              p.first_name AS submitted_by_first_name, p.last_name AS submitted_by_last_name,
              named.first_name AS named_parent_first_name, named.last_name AS named_parent_last_name
       FROM birth_records br
       LEFT JOIN citizens c ON c.citizen_id = br.citizen_id
       LEFT JOIN citizens p ON p.citizen_id = br.parent_citizen_id
       LEFT JOIN citizens named ON named.citizen_id = br.father_citizen_id
       WHERE br.father_confirmation_status IN ('Disputed', 'Dispute Upheld')
       UNION ALL
       SELECT br.birth_record_id, br.registration_reference, br.child_first_name, br.child_last_name,
              'mother' AS disputed_role, br.mother_confirmation_status AS confirmation_status, br.mother_dispute_reason AS dispute_reason, br.updated_at,
              c.first_name AS child_first_name_full, c.last_name AS child_last_name_full,
              p.first_name AS submitted_by_first_name, p.last_name AS submitted_by_last_name,
              named.first_name AS named_parent_first_name, named.last_name AS named_parent_last_name
       FROM birth_records br
       LEFT JOIN citizens c ON c.citizen_id = br.citizen_id
       LEFT JOIN citizens p ON p.citizen_id = br.parent_citizen_id
       LEFT JOIN citizens named ON named.citizen_id = br.mother_citizen_id
       WHERE br.mother_confirmation_status IN ('Disputed', 'Dispute Upheld')
       ORDER BY updated_at DESC`
    );
    res.json({ disputes: rows });
  } catch (err) { next(err); }
}

/** POST /api/home-affairs/parentage-disputes/:id/resolve  body: { resolution: 'Upheld'|'Dismissed', role: 'father'|'mother', notes }
 * Dismissed just records the officer's decision and notifies both sides — the registration and
 * certificate were correct all along. Upheld means the officer agrees the named person really
 * isn't this child's parent: that parent's fields are cleared from the birth record (name,
 * citizen link, identity/passport details all wiped back to an unset "Unknown" slot) and the
 * linked birth certificate is flagged 'Flagged for Correction' so it's visibly no longer fully
 * trusted. A corrections-table entry is also logged (already-Approved, since the officer is
 * enacting it directly here) so this shows up in Home Affairs' normal corrections audit trail. */
async function resolveParentageDispute(req, res, next) {
  if (!['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey)) {
    return res.status(403).json({ error: 'Officer only.' });
  }
  const { resolution, role, notes } = req.body;
  if (!['Upheld', 'Dismissed'].includes(resolution)) return res.status(400).json({ error: "resolution must be 'Upheld' or 'Dismissed'." });
  if (!['father', 'mother'].includes(role)) return res.status(400).json({ error: "role must be 'father' or 'mother'." });
  const client = await db.getClient();
  try {
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM birth_records WHERE birth_record_id = $1 FOR UPDATE', [req.params.id]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Dispute not found.' }); }
      const record = rows[0];
      const statusCol = `${role}_confirmation_status`;
      if (record[statusCol] !== 'Disputed') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'This parent slot is not currently disputed.' }); }
      const newStatus = resolution === 'Upheld' ? 'Dispute Upheld' : 'Dispute Dismissed';

      if (resolution === 'Upheld') {
        await client.query(
          `UPDATE birth_records SET
                  ${role}_name = NULL, ${role}_is_citizen = NULL, ${role}_identity_number = NULL,
                  ${role}_citizen_id = NULL, ${role}_passport_number = NULL, ${role}_passport_image_reference = NULL,
                  ${role}_declared_status = 'Unknown',
                  ${role}_confirmation_status = $1, ${role}_dispute_resolved_by_user_id = $2, ${role}_dispute_resolved_at = NOW(), updated_at = NOW()
           WHERE birth_record_id = $3`,
          [newStatus, req.user.userId, record.birth_record_id]
        );
        await client.query(
          `UPDATE birth_certificates SET status = 'Flagged for Correction', updated_at = NOW() WHERE birth_record_id = $1`,
          [record.birth_record_id]
        );
        if (record.citizen_id) {
          const departmentId = await getDepartmentId('home_affairs');
          await client.query(
            `INSERT INTO corrections (citizen_id, requested_by_user_id, department_id, field_name, current_value, requested_value, reason, status, reviewed_by_user_id, reviewed_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'Approved',$2,NOW())`,
            [record.citizen_id, req.user.userId, departmentId, `${role}_citizen_id`,
             record[`${role}_citizen_id`] != null ? String(record[`${role}_citizen_id`]) : null,
             'Cleared — parentage dispute upheld',
             [record[`${role}_dispute_reason`], notes].filter(Boolean).join(' | ') || 'Parentage dispute upheld; this parent slot was cleared.']
          );
        }
      } else {
        await client.query(
          `UPDATE birth_records SET ${role}_confirmation_status = $1, ${role}_dispute_resolved_by_user_id = $2,
                  ${role}_dispute_resolved_at = NOW(), updated_at = NOW() WHERE birth_record_id = $3`,
          [newStatus, req.user.userId, record.birth_record_id]
        );
      }
      await recordAudit({
        userId: req.user.userId, departmentId: await getDepartmentId('home_affairs'), action: 'PARENTAGE_DISPUTE_RESOLVED',
        targetType: 'birth_record', targetId: record.birth_record_id, reason: notes || null, metadata: { resolution, role },
      });
      await client.query('COMMIT');

      // Only the two people actually party to THIS dispute — the applicant who registered the
      // birth, and the parent who disputed being named in this role — are notified; the other,
      // uninvolved parent (if there is one) is left alone. Upheld needs both to physically sort
      // this out before anything more can happen, so they're explicitly told to visit an office;
      // Dismissed just reports the outcome.
      const notifyIds = [record.parent_citizen_id, record[`${role}_citizen_id`]].filter(Boolean);
      const upheldMessage = `The dispute over the ${role} named on birth registration ${record.registration_reference} was upheld — the ${role} has been removed from the record and the certificate has been flagged for correction. Please visit a Home Affairs office with the other party to discuss this, so an officer can enter the correct parent details.${notes ? ` Officer's notes: ${notes}` : ''}`;
      const dismissedMessage = `The dispute over the ${role} named on birth registration ${record.registration_reference} was dismissed — the registration and certificate stand as they were.${notes ? ` Officer's notes: ${notes}` : ''}`;
      for (const citizenId of notifyIds) {
        const { rows: userRows } = await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [citizenId]);
        if (userRows[0]) {
          await createNotification({
            userId: userRows[0].user_id, title: 'Parentage dispute resolved',
            message: resolution === 'Upheld' ? upheldMessage : dismissedMessage,
            type: 'Status Change',
          });
        }
      }
      res.json({ birthRecordId: record.birth_record_id, role, status: newStatus });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } catch (err) { next(err); } finally { client.release(); }
}

/**
 * POST /api/home-affairs/birth-registration/:id/correct-parent
 * body: { role: 'father'|'mother', name, nationality, isCitizen, identityNumber, passportNumber,
 *         passportImageReference, declaredStatus }
 *
 * The other half of resolveParentageDispute's Upheld path. Upholding a dispute only clears the
 * wrong parent out — it deliberately does NOT guess who the right one is. This is where an
 * officer, after the applicant and the disputing parent have come in and discussed it in person
 * (as the dispute-resolved notification tells them to), enters what was actually agreed and
 * closes the correction out. Only usable on a slot that is currently 'Dispute Upheld' — there is
 * nothing to "correct" on a slot that was never cleared in the first place.
 *
 * Reuses the exact same resolveParentDetails() verification (and the same minimum age-gap check)
 * used at registration time, so an officer can't enter something that wouldn't have been accepted
 * from a citizen either — a real identity number that doesn't match a citizen, or a parent who
 * isn't old enough to be this child's parent, is rejected here exactly the same way.
 */
async function correctParentageDispute(req, res, next) {
  if (!['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey)) {
    return res.status(403).json({ error: 'Officer only.' });
  }
  const { role } = req.body;
  if (!['father', 'mother'].includes(role)) return res.status(400).json({ error: "role must be 'father' or 'mother'." });
  const declaredStatus = validateDeclaredStatus(role, req.body.declaredStatus);
  const client = await db.getClient();
  try {
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM birth_records WHERE birth_record_id = $1 FOR UPDATE', [req.params.id]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Birth record not found.' }); }
      const record = rows[0];
      const statusCol = `${role}_confirmation_status`;
      if (record[statusCol] !== 'Dispute Upheld') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `This parent slot is not awaiting correction (status: ${record[statusCol]}).` });
      }

      const resolved = await resolveParentDetails(client, {
        label: role, name: req.body.name, isCitizen: req.body.isCitizen, identityNumber: req.body.identityNumber,
        passportNumber: req.body.passportNumber, passportImageReference: req.body.passportImageReference, declaredStatus,
      });
      const problems = [...resolved.missing.map((f) => `${f} is required.`), ...resolved.rejections];
      if (violatesMinParentAgeGap(resolved.stored.dateOfBirth, record.date_of_birth)) {
        problems.push(`The ${role}'s date of birth on record is not consistent with being this child's parent (must be at least ${MIN_PARENT_AGE_GAP_YEARS} years older).`);
      }
      if (problems.length > 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: problems.join(' ') }); }

      // Same eligibility rule as a brand-new registration: a corrected parent who resolves to a
      // real citizen with no declared status is sent through the normal non-blocking confirm/
      // dispute flow again (they get notified and can confirm or dispute this too); Unknown/
      // Absent/Inactive/Deceased settle immediately since there's no account to reach or nothing
      // left to confirm.
      const newConfirmationStatus = (resolved.stored.citizenId && !declaredStatus) ? 'Pending' : 'Not Applicable';

      await client.query(
        `UPDATE birth_records SET
                ${role}_name = $1, ${role}_nationality = $2, ${role}_is_citizen = $3, ${role}_identity_number = $4,
                ${role}_citizen_id = $5, ${role}_passport_number = $6, ${role}_passport_image_reference = $7,
                ${role}_declared_status = $8, ${role}_confirmation_status = $9, ${role}_confirmed_at = NULL,
                ${role}_confirmation_signature_reference = NULL, ${role}_dispute_reason = NULL,
                updated_at = NOW()
         WHERE birth_record_id = $10`,
        [resolved.stored.name, req.body.nationality || 'Mosotho', resolved.stored.isCitizen, resolved.stored.identityNumber,
         resolved.stored.citizenId, resolved.stored.passportNumber, resolved.stored.passportImageReference,
         declaredStatus, newConfirmationStatus, record.birth_record_id]
      );
      await client.query(
        `UPDATE birth_certificates SET status = 'Ready for Collection', ready_for_collection_at = NOW(), updated_at = NOW()
         WHERE birth_record_id = $1 AND status = 'Flagged for Correction'`,
        [record.birth_record_id]
      );
      if (record.citizen_id) {
        const departmentId = await getDepartmentId('home_affairs');
        await client.query(
          `INSERT INTO corrections (citizen_id, requested_by_user_id, department_id, field_name, current_value, requested_value, reason, status, reviewed_by_user_id, reviewed_at)
           VALUES ($1,$2,$3,$4,'Unknown (cleared)',$5,$6,'Approved',$2,NOW())`,
          [record.citizen_id, req.user.userId, departmentId, `${role}_name`,
           resolved.stored.name || `${role} marked ${declaredStatus || 'Present'}`,
           'Corrected in person after an upheld parentage dispute — applicant and the disputing parent met with an officer.']
        );
      }
      await recordAudit({
        userId: req.user.userId, departmentId: await getDepartmentId('home_affairs'), action: 'PARENTAGE_CORRECTED',
        targetType: 'birth_record', targetId: record.birth_record_id, metadata: { role },
      });
      await client.query('COMMIT');

      if (record.parent_citizen_id) {
        const { rows: submitterUserRows } = await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.parent_citizen_id]);
        if (submitterUserRows[0]) {
          await createNotification({
            userId: submitterUserRows[0].user_id, title: 'Birth record corrected',
            message: `The ${role} on birth registration ${record.registration_reference} has been corrected by a Home Affairs officer. The certificate is ready for collection again.`,
            type: 'Status Change',
          });
        }
      }
      if (newConfirmationStatus === 'Pending' && resolved.stored.citizenId) {
        const { rows: newParentUserRows } = await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [resolved.stored.citizenId]);
        if (newParentUserRows[0]) {
          await createNotification({
            userId: newParentUserRows[0].user_id, title: 'You were named as a parent on a birth registration',
            message: `Birth registration ${record.registration_reference} names you as a parent, following a correction by a Home Affairs officer. Please review and confirm or dispute it in your account.`,
            type: 'Verification',
          });
        }
      }

      res.json({ birthRecordId: record.birth_record_id, role, confirmationStatus: newConfirmationStatus });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } catch (err) { next(err); } finally { client.release(); }
}

// allowOwner: when true, the citizen who owns the record may also call this transition (in
// addition to officers) — used by resubmit, below. Every other transition in this file leaves
// it false, so officer-only behaviour is unchanged everywhere except resubmit.
async function transitionBirthRegistration(req, res, next, { from, to, sideEffect, allowOwner = false }) {
  try {
    const isOfficer = req.user.roleKey === 'home_affairs_officer' || req.user.roleKey === 'system_administrator';
    if (!isOfficer && !allowOwner) {
      return res.status(403).json({ error: 'Only Home Affairs officers can perform this action.' });
    }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM birth_records WHERE birth_record_id = $1 FOR UPDATE', [req.params.id]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Birth registration not found.' }); }
      const record = rows[0];
      if (!isOfficer && record.parent_citizen_id !== req.user.citizenId) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Not your application.' });
      }
      if (Array.isArray(from) ? !from.includes(record.registration_status) : record.registration_status !== from) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Cannot move from '${record.registration_status}' to '${to}'.` });
      }
      const result = await (sideEffect ? sideEffect(client, record, req) : Promise.resolve({}));
      await client.query('COMMIT');
      res.json({ birthRecordId: record.birth_record_id, status: result.status || to, ...result.extra });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

/** POST /:id/start-review — Submitted -> Under Review */
function startReviewBirthRegistration(req, res, next) {
  return transitionBirthRegistration(req, res, next, {
    from: 'Submitted', to: 'Under Review',
    sideEffect: async (client, record) => {
      await client.query(`UPDATE birth_records SET registration_status = 'Under Review', handling_officer_id = $1, updated_at = NOW() WHERE birth_record_id = $2`, [req.user.userId, record.birth_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'birth_records', sourceId: record.birth_record_id, status: 'Under Review' });
      return { status: 'Under Review' };
    },
  });
}

/** POST /:id/request-information  body: { reason } — Under Review -> Information Required */
function requestInformationBirthRegistration(req, res, next) {
  const { reason } = req.body;
  return transitionBirthRegistration(req, res, next, {
    from: ['Under Review', 'Verification in Progress'], to: 'Information Required',
    sideEffect: async (client, record) => {
      if (!reason) throw Object.assign(new Error('A reason is required when requesting additional information.'), { status: 400 });
      await client.query(`UPDATE birth_records SET registration_status = 'Information Required', updated_at = NOW() WHERE birth_record_id = $1`, [record.birth_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'birth_records', sourceId: record.birth_record_id, status: 'Information Required' });
      await createNotification({
        userId: (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.parent_citizen_id])).rows[0]?.user_id,
        title: 'Additional information required', message: `Reference ${record.registration_reference}: ${reason}`, type: 'Missing Information',
      });
      return { status: 'Information Required' };
    },
  });
}

/** POST /:id/resubmit (citizen, owner only) — Feature 4: lets the citizen correct and resubmit
 *  after either Information Required OR Rejected, instead of starting a brand-new application.
 *  Unlike the old version (which only flipped the status back with no way to actually fix
 *  anything), this accepts the same fields createBirthRegistration does and saves the edits. */
function resubmitBirthRegistration(req, res, next) {
  const {
    childFirstName, childMiddleName, childLastName, dateOfBirth, placeOfBirth, sex,
    fatherName, fatherNationality, motherName, motherMaidenSurname, motherNationality, motherResidence,
  } = req.body;
  return transitionBirthRegistration(req, res, next, {
    from: ['Information Required', 'Rejected'], to: 'Under Review', allowOwner: true,
    sideEffect: async (client, record) => {
      if (!childFirstName || !childLastName || !dateOfBirth || !placeOfBirth || !sex) {
        throw Object.assign(new Error('childFirstName, childLastName, dateOfBirth, placeOfBirth and sex are required.'), { status: 400 });
      }
      // informant_name/informant_capacity/informant_residence are no longer collected anywhere
      // (nobody registers someone else's birth any more — see migration 059 and
      // BirthRegistrationDetail.jsx) — left untouched here rather than overwritten with nulls, so
      // any informant data already on an old, still-pending legacy record isn't silently erased
      // by a resubmit that has nothing to say about it.
      await client.query(
        `UPDATE birth_records SET registration_status = 'Under Review', rejection_reason = NULL,
            child_first_name = $1, child_middle_name = $2, child_last_name = $3, date_of_birth = $4, place_of_birth = $5, sex = $6,
            father_name = $7, father_nationality = $8, mother_name = $9, mother_maiden_surname = $10, mother_nationality = $11,
            mother_residence = $12, updated_at = NOW()
         WHERE birth_record_id = $13`,
        [childFirstName, childMiddleName || null, childLastName, dateOfBirth, placeOfBirth, sex,
         fatherName || null, fatherNationality || 'Mosotho', motherName || null, motherMaidenSurname || null, motherNationality || 'Mosotho',
         motherResidence || null, record.birth_record_id]
      );
      await syncApplicationStatus(client, { sourceTable: 'birth_records', sourceId: record.birth_record_id, status: 'Under Review' });
      return { status: 'Under Review' };
    },
  });
}

/** POST /:id/verify — Under Review -> Verification in Progress */
function verifyBirthRegistration(req, res, next) {
  return transitionBirthRegistration(req, res, next, {
    from: 'Under Review', to: 'Verification in Progress',
    sideEffect: async (client, record) => {
      await client.query(`UPDATE birth_records SET registration_status = 'Verification in Progress', handling_officer_id = $1, updated_at = NOW() WHERE birth_record_id = $2`, [req.user.userId, record.birth_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'birth_records', sourceId: record.birth_record_id, status: 'Verification in Progress' });
      return { status: 'Verification in Progress' };
    },
  });
}

/** POST /:id/confirm-verification — Verification in Progress -> Verified */
function confirmVerificationBirthRegistration(req, res, next) {
  return transitionBirthRegistration(req, res, next, {
    from: 'Verification in Progress', to: 'Verified',
    sideEffect: async (client, record) => {
      await client.query(`UPDATE birth_records SET registration_status = 'Verified', verified_at = NOW(), updated_at = NOW() WHERE birth_record_id = $1`, [record.birth_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'birth_records', sourceId: record.birth_record_id, status: 'Verified' });
      return { status: 'Verified' };
    },
  });
}

/**
 * POST /:id/approve — Verified -> Approved.
 * THIS is the only place a child citizen identity + permanent_identity_number + birth
 * certificate get created. Everything before this point is workflow only.
 */
function approveBirthRegistration(req, res, next) {
  return transitionBirthRegistration(req, res, next, {
    from: 'Verified', to: 'Approved',
    sideEffect: async (client, record) => {
      const citizenId = await withUniquePermanentId(record.date_of_birth, async (candidatePin) => {
        const { rows } = await client.query(
          `INSERT INTO citizens (permanent_identity_number, first_name, middle_name, last_name,
              date_of_birth, place_of_birth, sex, citizenship_status, identity_verification_status,
              parent_citizen_id, is_demo_data)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'Citizen','Verified',$8,TRUE) RETURNING citizen_id`,
          [candidatePin, record.child_first_name, record.child_middle_name, record.child_last_name,
           record.date_of_birth, record.place_of_birth, record.sex, record.parent_citizen_id]
        );
        return rows[0].citizen_id;
      });

      await client.query(
        `UPDATE birth_records SET registration_status = 'Approved', citizen_id = $1, approved_at = NOW(), updated_at = NOW() WHERE birth_record_id = $2`,
        [citizenId, record.birth_record_id]
      );
      await syncApplicationStatus(client, { sourceTable: 'birth_records', sourceId: record.birth_record_id, status: 'Approved', completed: false });

      const certificateNumber = generateReference('BC');
      // Carries over the branch the citizen chose when they applied, so the certificate already
      // shows its intended collection point the moment it exists — an officer can still change
      // it later at the Ready for Collection step if that branch can't fulfil it.
      const { rows: certRows } = await client.query(
        `INSERT INTO birth_certificates (citizen_id, birth_record_id, certificate_number, issue_date, status, collection_office_id)
         VALUES ($1,$2,$3, CURRENT_DATE, 'Certificate Generated', $4) RETURNING birth_certificate_id`,
        [citizenId, record.birth_record_id, certificateNumber, record.preferred_office_id]
      );

      const parentUser = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.parent_citizen_id])).rows[0];
      if (parentUser) {
        await createNotification({
          userId: parentUser.user_id, title: 'Birth registration approved',
          message: `Birth registration ${record.registration_reference} has been approved. A birth certificate (${certificateNumber}) has been generated and is being prepared for collection.`,
          type: 'Approval',
        });
      }
      await recordAudit({
        userId: req.user.userId, departmentId: await getDepartmentId('home_affairs'),
        action: 'BIRTH_REGISTRATION_APPROVED', targetType: 'birth_record', targetId: record.birth_record_id,
        metadata: { citizenId, certificateNumber },
      });

      return { status: 'Approved', extra: { citizenId, birthCertificateId: certRows[0].birth_certificate_id, certificateNumber } };
    },
  });
}

/** POST /:id/reject  body: { reason } */
function rejectBirthRegistration(req, res, next) {
  const { reason } = req.body;
  return transitionBirthRegistration(req, res, next, {
    from: ['Submitted', 'Under Review', 'Information Required', 'Verification in Progress', 'Verified'],
    to: 'Rejected',
    sideEffect: async (client, record) => {
      if (!reason) throw Object.assign(new Error('A reason is required to reject an application.'), { status: 400 });
      await client.query(`UPDATE birth_records SET registration_status = 'Rejected', rejection_reason = $1, updated_at = NOW() WHERE birth_record_id = $2`, [reason, record.birth_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'birth_records', sourceId: record.birth_record_id, status: 'Rejected', completed: true });
      const parentUser = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.parent_citizen_id])).rows[0];
      if (parentUser) {
        await createNotification({ userId: parentUser.user_id, title: 'Birth registration rejected', message: `Reference ${record.registration_reference}: ${reason}`, type: 'Rejection' });
      }
      return { status: 'Rejected' };
    },
  });
}

// ============================================================================================
// BIRTH CERTIFICATE
// ============================================================================================

/** GET /api/home-affairs/birth-certificate/:id */
async function getBirthCertificate(req, res, next) {
  try {
    const { rows } = await db.query(
      // LEFT JOIN on the parent — a self-application (migration 059: someone with no account
      // applying for their OWN birth certificate) has no submitting parent at all, so
      // parent_citizen_id is NULL for it. This used to be an inner JOIN, which silently excluded
      // every self-application's certificate from this query entirely — "Birth certificate not
      // found" even though it plainly existed. Fixed.
      `SELECT bc.*, c.first_name, c.middle_name, c.last_name, c.date_of_birth, c.place_of_birth,
              c.sex, c.permanent_identity_number, o.name AS collection_office_name,
              br.parent_citizen_id, p.first_name AS parent_first_name, p.last_name AS parent_last_name,
              br.father_name, br.father_nationality, br.mother_name, br.mother_maiden_surname,
              br.mother_nationality, br.mother_residence, br.approved_at AS date_of_registration
       FROM birth_certificates bc
       JOIN citizens c ON c.citizen_id = bc.citizen_id
       JOIN birth_records br ON br.birth_record_id = bc.birth_record_id
       LEFT JOIN citizens p ON p.citizen_id = br.parent_citizen_id
       LEFT JOIN offices o ON o.office_id = bc.collection_office_id
       WHERE bc.birth_certificate_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Birth certificate not found.' });
    const cert = rows[0];
    // Two different people can legitimately own this certificate: the parent/guardian who
    // registered it (parent_citizen_id), or the person it's actually FOR (bc.citizen_id) — the
    // latter is the only one who can own a self-application's certificate, since that flow has
    // no registering parent at all, and it's also just as true for a certificate a parent
    // registered once that child grows up, creates their own account, and logs in.
    const isOwner = !!req.user.citizenId && (cert.citizen_id === req.user.citizenId || cert.parent_citizen_id === req.user.citizenId);
    const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey);
    if (!isOwner && !isOfficer) return res.status(403).json({ error: 'You do not have access to this certificate.' });
    res.json({ birthCertificate: cert });
  } catch (err) {
    next(err);
  }
}

/** POST /api/home-affairs/birth-certificate/:id/ready-for-collection (officer) */
async function markCertificateReadyForCollection(req, res, next) {
  try {
    if (!['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { officeId } = req.body;
    // Birth certificate collection is free in Lesotho — verified against the Ministry of Home
    // Affairs' and gov.ls's published service pages, which list no fee for birth certificate
    // registration or collection (unlike a Passport, which genuinely does carry an application/
    // replacement fee — see passport.controller.js). No payment or receipt is required here.
    // (A payment_reference/receipt_image_reference pair still exists on this table from an
    // earlier, incorrect assumption that a collection fee applied — those columns are simply
    // left unused by this standard flow now; see migration 033's updated comment.)
    //
    // COALESCE: an officer can override the branch here, but if they don't, the office already
    // set (from the citizen's choice at application time) is kept rather than cleared.
    const { rows } = await db.query(
      `UPDATE birth_certificates SET status = 'Ready for Collection', collection_office_id = COALESCE($1, collection_office_id),
              ready_for_collection_at = NOW(), updated_at = NOW()
       WHERE birth_certificate_id = $2 AND status = 'Certificate Generated' RETURNING *`,
      [officeId || null, req.params.id]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Certificate is not in a state that can move to Ready for Collection.' });
    res.json({ birthCertificate: rows[0] });
  } catch (err) {
    next(err);
  }
}

/** POST /api/home-affairs/birth-certificate/:id/collect (officer confirms physical collection) */
async function collectBirthCertificate(req, res, next) {
  try {
    if (!['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    // Collection (Feature 3): the citizen signs on a pad at the counter before the officer can
    // mark the certificate collected — see database/migrations/035_add_signature_reference.sql.
    const { signatureReference } = req.body;
    if (!signatureReference) return res.status(400).json({ error: 'The citizen\'s signature is required before the certificate can be marked collected.' });
    const { rows } = await db.query(
      `UPDATE birth_certificates SET status = 'Collected', collected_at = NOW(), signature_reference = $2, updated_at = NOW()
       WHERE birth_certificate_id = $1 AND status = 'Ready for Collection' RETURNING *`,
      [req.params.id, signatureReference]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Certificate must be Ready for Collection before it can be marked Collected.' });
    await recordAudit({ userId: req.user.userId, departmentId: await getDepartmentId('home_affairs'), action: 'BIRTH_CERTIFICATE_COLLECTED', targetType: 'birth_certificate', targetId: Number(req.params.id) });
    res.json({ birthCertificate: rows[0] });
  } catch (err) {
    next(err);
  }
}

// ============================================================================================
// NATIONAL ID CARD — reuses the existing permanent identity number. Never generates a new one.
//
// Enhanced per the client's explicit requirements (see migration 063):
//  1. 16+ only for a first ("New") application.
//  2. Once a citizen has actually COLLECTED a card, applyNationalId is closed to them forever —
//     renewal/replacement is the only path back in.
//  3. Renewal is blocked unless the current card has actually expired.
//  4. Replacement (Lost/Stolen/Damaged) requires a supporting document; Lost/Stolen additionally
//     impose a 3-month wait from the date the citizen reports losing it.
//  5. Hand-biometric capture happens once per citizen (citizen_biometrics, migration 052) and is
//     reused for every later application. The FIRST time a citizen ever needs it captured, they
//     choose a police station and a police_officer there captures it in person
//     (captureNationalIdBiometrics below); every other application — because the citizen is
//     already enrolled — skips that step entirely. Either way, the moment biometrics are
//     confirmed (fresh capture or reuse) the card is auto-approved and sent straight to
//     production — only the physical Card Production -> Ready for Collection -> Collected steps
//     are left for an officer, exactly like a birth certificate.
// ============================================================================================

const MIN_NATIONAL_ID_AGE = 16;
const NATIONAL_ID_VALIDITY_YEARS = 10; // matches the INTERVAL '10 years' used in getNationalId
const NATIONAL_ID_LOST_WAIT_MONTHS = 3;

function calculateAgeYears(dateOfBirth) {
  const dob = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age -= 1;
  return age;
}

/** Adds `months` calendar months to a date (UTC), the same style of date math used elsewhere in
 *  this file (violatesMinParentAgeGap) rather than a rough "90 days" approximation. */
function addMonthsUTC(date, months) {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function generateCardNumber() {
  return 'NID-' + generateReference('').replace(/^-/, '').replace(/-/g, '');
}

/** True once BOTH hands are on file in citizen_biometrics for this citizen, from ANY earlier
 *  service — the "captured once, reused everywhere" rule the client asked for. */
async function hasBothHandsEnrolled(queryable, citizenId) {
  const { rows } = await queryable.query(
    'SELECT left_hand_captured_at, right_hand_captured_at FROM citizen_biometrics WHERE citizen_id = $1',
    [citizenId]
  );
  return !!(rows[0] && rows[0].left_hand_captured_at && rows[0].right_hand_captured_at);
}

/** Confirms officeId is a real office belonging to the Police department — used to validate the
 *  citizen's chosen biometric-capture station (as distinct from preferredOfficeId, which is
 *  always a Home Affairs branch, for card collection). */
async function isPoliceOffice(queryable, officeId) {
  const { rows } = await queryable.query(
    `SELECT 1 FROM offices o JOIN departments d ON d.department_id = o.department_id WHERE o.office_id = $1 AND d.department_key = 'police'`,
    [officeId]
  );
  return rows.length > 0;
}

/** Moves a just-approved national_id_cards row straight to 'Card Production' with a freshly
 *  assigned card number — the one place "fully automatic, same as birth certificates" actually
 *  happens, used identically whether biometrics were just captured at a police station or were
 *  already on file from an earlier service. Must be called inside an open transaction on `client`
 *  with the row already locked (SELECT ... FOR UPDATE). */
async function autoProduceNationalId(client, nationalIdCardId) {
  const cardNumber = generateCardNumber();
  await client.query(
    `UPDATE national_id_cards SET production_status = 'Card Production', approval_date = CURRENT_DATE,
        card_number = $1, biometric_status = 'Enrolled', updated_at = NOW()
     WHERE national_id_card_id = $2`,
    [cardNumber, nationalIdCardId]
  );
  await syncApplicationStatus(client, { sourceTable: 'national_id_cards', sourceId: nationalIdCardId, status: 'Card Production' });
  return cardNumber;
}

/** GET /api/home-affairs/national-id/eligibility — everything NationalIdApply.jsx and
 *  NationalIdRenewReplace.jsx need to decide what to show, computed server-side so the actual
 *  eligibility rules live in exactly one place. */
async function getNationalIdEligibility(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required.' });
    const { rows: citizenRows } = await db.query('SELECT date_of_birth FROM citizens WHERE citizen_id = $1', [req.user.citizenId]);
    if (citizenRows.length === 0) return res.status(404).json({ error: 'Citizen record not found.' });
    const age = calculateAgeYears(citizenRows[0].date_of_birth);

    const { rows } = await db.query(
      `SELECT national_id_card_id, production_status, card_number, approval_date,
              (approval_date + (${NATIONAL_ID_VALIDITY_YEARS} || ' years')::interval)::date AS expiry_date
       FROM national_id_cards WHERE citizen_id = $1 ORDER BY application_date DESC`,
      [req.user.citizenId]
    );
    const collectedCardRow = rows.find((r) => r.production_status === 'Collected') || null;
    const hasInProgressApplication = rows.some((r) => !['Rejected', 'Collected'].includes(r.production_status));
    const today = new Date().toISOString().slice(0, 10);
    const isExpired = !!(collectedCardRow && collectedCardRow.expiry_date && String(collectedCardRow.expiry_date).slice(0, 10) < today);
    const biometricsOnFile = await hasBothHandsEnrolled(db, req.user.citizenId);

    // The renewal/replacement form no longer asks the citizen to take a new photo at all — it
    // always carries the existing one forward (see applyNationalIdRenewalReplacement) — and
    // instead DISPLAYS the current card on screen so the citizen can see exactly what they're
    // renewing/replacing. That display needs the same identity/photo fields getNationalId
    // already pulls together for the full card view, so they're fetched here too, but only for
    // the one row that matters (collectedCardRow), not the whole list above.
    let collectedCard = null;
    if (collectedCardRow) {
      const { rows: detailRows } = await db.query(
        `SELECT n.photo_reference, c.first_name, c.middle_name, c.last_name, c.sex, c.date_of_birth, c.citizenship_status, c.permanent_identity_number
         FROM national_id_cards n JOIN citizens c ON c.citizen_id = n.citizen_id
         WHERE n.national_id_card_id = $1`,
        [collectedCardRow.national_id_card_id]
      );
      const detail = detailRows[0] || {};
      collectedCard = {
        cardNumber: collectedCardRow.card_number, approvalDate: collectedCardRow.approval_date, expiryDate: collectedCardRow.expiry_date, isExpired,
        photoReference: detail.photo_reference, firstName: detail.first_name, middleName: detail.middle_name, lastName: detail.last_name,
        sex: detail.sex, dateOfBirth: detail.date_of_birth, citizenshipStatus: detail.citizenship_status, permanentIdentityNumber: detail.permanent_identity_number,
      };
    }

    res.json({
      age,
      meetsMinimumAge: age >= MIN_NATIONAL_ID_AGE,
      minimumAge: MIN_NATIONAL_ID_AGE,
      hasCollectedCard: !!collectedCard,
      collectedCard,
      hasInProgressApplication,
      biometricsOnFile,
      allowedReplacementReasons: ['Lost', 'Stolen', 'Damaged'],
      lostWaitMonths: NATIONAL_ID_LOST_WAIT_MONTHS,
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/home-affairs/national-id/apply (citizen, must already have a verified identity) */
async function applyNationalId(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to apply for a National ID card.' });
    const { rows: citizenRows } = await db.query('SELECT * FROM citizens WHERE citizen_id = $1', [req.user.citizenId]);
    const citizen = citizenRows[0];

    if (calculateAgeYears(citizen.date_of_birth) < MIN_NATIONAL_ID_AGE) {
      return res.status(400).json({ error: `You must be at least ${MIN_NATIONAL_ID_AGE} years old to apply for a National ID card.` });
    }

    const { rows: existing } = await db.query(
      `SELECT production_status FROM national_id_cards WHERE citizen_id = $1 AND production_status NOT IN ('Rejected', 'Collected')`,
      [req.user.citizenId]
    );
    if (existing.length > 0) return res.status(409).json({ error: 'You already have a National ID card application in progress.' });

    const { rows: alreadyCollected } = await db.query(
      `SELECT 1 FROM national_id_cards WHERE citizen_id = $1 AND production_status = 'Collected'`,
      [req.user.citizenId]
    );
    if (alreadyCollected.length > 0) {
      return res.status(409).json({ error: 'You have already obtained a National ID card. Use the renewal or replacement service instead of a new application.' });
    }

    const { photoReference, preferredOfficeId, biometricOfficeId } = req.body;
    if (!preferredOfficeId) {
      return res.status(400).json({ error: 'preferredOfficeId is required — choose the branch where you will collect the card.' });
    }
    const alreadyEnrolled = await hasBothHandsEnrolled(db, req.user.citizenId);
    if (!alreadyEnrolled) {
      if (!biometricOfficeId) {
        return res.status(400).json({ error: 'biometricOfficeId is required — choose the police station where you will have your biometrics captured.' });
      }
      if (!(await isPoliceOffice(db, biometricOfficeId))) {
        return res.status(400).json({ error: 'biometricOfficeId must be a valid police station.' });
      }
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO national_id_cards (citizen_id, permanent_identity_number, application_date, production_status, photo_reference, biometric_status, preferred_office_id, collection_office_id, biometric_office_id)
         VALUES ($1,$2, CURRENT_DATE, $3, $4, $5, $6, $6, $7) RETURNING national_id_card_id`,
        [req.user.citizenId, citizen.permanent_identity_number, alreadyEnrolled ? 'Application Submitted' : 'Awaiting Biometric Capture',
          photoReference || null, alreadyEnrolled ? 'Enrolled' : 'Not Enrolled', preferredOfficeId, alreadyEnrolled ? null : biometricOfficeId]
      );
      const nationalIdCardId = rows[0].national_id_card_id;
      const referenceNumber = generateReference('NIDA');
      await indexApplication(client, {
        citizenId: req.user.citizenId, departmentKey: 'home_affairs', serviceType: 'National ID Card',
        referenceNumber, sourceTable: 'national_id_cards', sourceId: nationalIdCardId, status: alreadyEnrolled ? 'Application Submitted' : 'Awaiting Biometric Capture',
      });
      let cardNumber = null;
      if (alreadyEnrolled) {
        // Already enrolled from an earlier service (e.g. a Driving Licence) — no police-station
        // visit needed at all; go straight to automatic issuance.
        const { rows: lockRows } = await client.query('SELECT * FROM national_id_cards WHERE national_id_card_id = $1 FOR UPDATE', [nationalIdCardId]);
        cardNumber = await autoProduceNationalId(client, lockRows[0].national_id_card_id);
      }
      await client.query('COMMIT');
      await createNotification({
        userId: req.user.userId, title: 'National ID application submitted',
        message: alreadyEnrolled
          ? `Reference ${referenceNumber}. Your biometrics are already on file, so your card has been approved and sent for production automatically. Your existing permanent identity number will be reused — no new number is issued.`
          : `Reference ${referenceNumber}. Please visit your chosen police station to have your biometrics captured — your card will be approved automatically once that's done. Your existing permanent identity number will be reused — no new number is issued.`,
        type: 'Application Submitted',
      });
      res.status(201).json({ nationalIdCardId, referenceNumber, status: alreadyEnrolled ? 'Card Production' : 'Awaiting Biometric Capture', cardNumber });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

/** POST /api/home-affairs/national-id/renew-replace — new service: "National ID card renewal
 *  & replacement". Deliberately reuses this same table/approval pipeline rather than a parallel
 *  one, since a renewal or replacement is still, physically, a new card row — see migration 037.
 *  Requires the citizen to already hold a COLLECTED card; a first application still goes through
 *  applyNationalId above. Both Renewal and Replacement are fully automatic here, same as a first
 *  application with biometrics already on file — a citizen who holds a previous collected card
 *  was, by definition, already enrolled when that card was produced, so there is never a second
 *  police-station visit for this. */
async function applyNationalIdRenewalReplacement(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to apply for a National ID card.' });
    const { applicationType, replacementReason, replacementDetails, replacementProofReference, reportedLostAt, preferredOfficeId, photoReference } = req.body;
    if (!['Renewal', 'Replacement'].includes(applicationType)) {
      return res.status(400).json({ error: "applicationType must be 'Renewal' or 'Replacement'." });
    }
    if (!preferredOfficeId) return res.status(400).json({ error: 'preferredOfficeId is required — choose the branch where you will collect the card.' });

    if (applicationType === 'Replacement') {
      if (!['Lost', 'Stolen', 'Damaged'].includes(replacementReason)) {
        return res.status(400).json({ error: "replacementReason must be 'Lost', 'Stolen' or 'Damaged'." });
      }
      if (!replacementProofReference) {
        return res.status(400).json({ error: 'A supporting document is required for a replacement application.' });
      }
      if (['Lost', 'Stolen'].includes(replacementReason)) {
        if (!reportedLostAt) {
          return res.status(400).json({ error: replacementReason === 'Stolen' ? 'The date your card was stolen is required.' : 'The date you lost the card is required.' });
        }
        const lostDate = new Date(reportedLostAt);
        if (Number.isNaN(lostDate.getTime()) || reportedLostAt > new Date().toISOString().slice(0, 10)) {
          return res.status(400).json({ error: 'The date reported cannot be in the future.' });
        }
        const eligibleFrom = addMonthsUTC(lostDate, NATIONAL_ID_LOST_WAIT_MONTHS);
        if (new Date() < eligibleFrom) {
          return res.status(409).json({
            error: `A ${NATIONAL_ID_LOST_WAIT_MONTHS}-month wait applies before a ${replacementReason.toLowerCase()} card can be replaced. You can apply again from ${eligibleFrom.toISOString().slice(0, 10)}.`,
            eligibleFrom: eligibleFrom.toISOString().slice(0, 10),
          });
        }
      }
    }

    const { rows: existingInProgress } = await db.query(
      `SELECT 1 FROM national_id_cards WHERE citizen_id = $1 AND production_status NOT IN ('Rejected', 'Collected')`,
      [req.user.citizenId]
    );
    if (existingInProgress.length > 0) return res.status(409).json({ error: 'You already have a National ID card application in progress.' });

    const { rows: previousRows } = await db.query(
      `SELECT * FROM national_id_cards WHERE citizen_id = $1 AND production_status = 'Collected' ORDER BY approval_date DESC LIMIT 1`,
      [req.user.citizenId]
    );
    if (previousRows.length === 0) {
      return res.status(409).json({ error: 'No collected National ID card found. Use the standard National ID Application for a first-time card.' });
    }
    const previous = previousRows[0];

    if (applicationType === 'Renewal') {
      const expiry = addMonthsUTC(previous.approval_date, NATIONAL_ID_VALIDITY_YEARS * 12);
      if (new Date() < expiry) {
        return res.status(409).json({
          error: `Your current card is not yet expired (it expires on ${expiry.toISOString().slice(0, 10)}). Renewal is only available once your card has expired.`,
          currentCardNumber: previous.card_number, expiryDate: expiry.toISOString().slice(0, 10),
        });
      }
    }

    const { rows: citizenRows } = await db.query('SELECT permanent_identity_number FROM citizens WHERE citizen_id = $1', [req.user.citizenId]);

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        // Biometrics are reused automatically (citizen_biometrics, not re-captured) — the holder
        // already has both hands on file, having gone through police-station capture (or a reuse
        // skip) for their previous card. Photo is carried forward too, unless a fresh one is given.
        `INSERT INTO national_id_cards
            (citizen_id, permanent_identity_number, application_date, production_status, photo_reference,
             biometric_status, preferred_office_id, collection_office_id,
             application_type, replacement_reason, replacement_details, replacement_proof_reference, reported_lost_at, previous_card_number)
         VALUES ($1,$2, CURRENT_DATE, 'Application Submitted', $3, 'Enrolled', $4, $4, $5, $6, $7, $8, $9, $10) RETURNING national_id_card_id`,
        [req.user.citizenId, citizenRows[0].permanent_identity_number, photoReference || previous.photo_reference,
          preferredOfficeId, applicationType, replacementReason || null, replacementDetails || null,
          replacementProofReference || null, reportedLostAt || null, previous.card_number || null]
      );
      const nationalIdCardId = rows[0].national_id_card_id;
      const referenceNumber = generateReference('NIDA');
      await indexApplication(client, {
        citizenId: req.user.citizenId, departmentKey: 'home_affairs',
        serviceType: applicationType === 'Renewal' ? 'National ID Renewal' : 'National ID Replacement',
        referenceNumber, sourceTable: 'national_id_cards', sourceId: nationalIdCardId, status: 'Application Submitted',
      });
      const { rows: lockRows } = await client.query('SELECT * FROM national_id_cards WHERE national_id_card_id = $1 FOR UPDATE', [nationalIdCardId]);
      const cardNumber = await autoProduceNationalId(client, lockRows[0].national_id_card_id);
      await client.query('COMMIT');
      await createNotification({ userId: req.user.userId, title: `National ID ${applicationType.toLowerCase()} submitted`, message: `Reference ${referenceNumber}. Your biometrics are already on file, so your ${applicationType.toLowerCase()} has been approved and sent for production automatically.`, type: 'Application Submitted' });
      res.status(201).json({ nationalIdCardId, referenceNumber, status: 'Card Production', cardNumber });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

/** GET /api/home-affairs/national-id — citizen: own. Officer: queue. */
async function listNationalId(req, res, next) {
  try {
    if (['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey)) {
      const { status } = req.query;
      const { rows } = await db.query(
        `SELECT n.*, c.first_name, c.last_name FROM national_id_cards n JOIN citizens c ON c.citizen_id = n.citizen_id
         WHERE $1::text IS NULL OR n.production_status = $1 ORDER BY n.application_date DESC`,
        [status || null]
      );
      return res.json({ nationalIdCards: rows });
    }
    if (!req.user.citizenId) return res.json({ nationalIdCards: [] });
    const { rows } = await db.query('SELECT * FROM national_id_cards WHERE citizen_id = $1 ORDER BY application_date DESC', [req.user.citizenId]);
    res.json({ nationalIdCards: rows });
  } catch (err) {
    next(err);
  }
}

/** GET /api/home-affairs/national-id/:id */
async function getNationalId(req, res, next) {
  try {
    const { rows } = await db.query(
      // The real National ID card shows the holder's name/DOB/sex and a "place of issue" (the
      // issuing office's district) and expiry date — none of which the card record itself
      // stores, so this pulls them in from citizens and offices/districts. Expiry is a
      // prototype convention (10 years from approval), computed here rather than stored.
      `SELECT n.*, c.first_name, c.middle_name, c.last_name, c.date_of_birth, c.sex, c.citizenship_status,
              o.name AS collection_office_name, d.name AS collection_office_district,
              (n.approval_date + INTERVAL '10 years')::date AS expiry_date
       FROM national_id_cards n
       JOIN citizens c ON c.citizen_id = n.citizen_id
       LEFT JOIN offices o ON o.office_id = n.collection_office_id
       LEFT JOIN districts d ON d.district_id = o.district_id
       WHERE n.national_id_card_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'National ID application not found.' });
    const record = rows[0];
    const isOwner = req.user.citizenId === record.citizen_id;
    const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey);
    if (!isOwner && !isOfficer) return res.status(403).json({ error: 'You do not have access to this application.' });
    res.json({ nationalIdCard: record });
  } catch (err) {
    next(err);
  }
}

const NID_TRANSITIONS = {
  'start-review': { from: 'Application Submitted', to: 'Under Review' },
  'verify': { from: 'Under Review', to: 'Verification in Progress' },
  'confirm-verification': { from: 'Verification in Progress', to: 'Approved', createsCard: false },
  'produce': { from: 'Approved', to: 'Card Production' },
  'ready-for-collection': { from: 'Card Production', to: 'Ready for Collection' },
  'collect': { from: 'Ready for Collection', to: 'Collected' },
};

/** POST /api/home-affairs/national-id/:id/:action (officer state machine) */
async function transitionNationalId(req, res, next) {
  try {
    if (!['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const action = req.params.action;
    const transition = NID_TRANSITIONS[action];
    if (!transition) return res.status(400).json({ error: `Unknown action: ${action}` });
    // Collection (Feature 3): the citizen signs on a pad at the counter before the officer can
    // mark the card collected — see database/migrations/035_add_signature_reference.sql.
    if (transition.to === 'Collected' && !req.body.signatureReference) {
      return res.status(400).json({ error: 'The citizen\'s signature is required before the card can be marked collected.' });
    }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM national_id_cards WHERE national_id_card_id = $1 FOR UPDATE', [req.params.id]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
      const record = rows[0];
      if (record.production_status !== transition.from) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Cannot move from '${record.production_status}' to '${transition.to}'.` });
      }
      let cardNumber = record.card_number;
      if (transition.to === 'Card Production' && !cardNumber) {
        cardNumber = 'NID-' + generateReference('').replace(/^-/, '').replace(/-/g, '');
      }
      const officeId = req.body.officeId || record.collection_office_id;
      await client.query(
        // $1 is cast explicitly everywhere it appears: used both to SET a varchar column and to
        // compare against text literals, Postgres cannot otherwise settle on one type for it
        // ("inconsistent types deduced for parameter $1") and rejects the whole statement.
        `UPDATE national_id_cards SET production_status = $1::varchar, card_number = COALESCE($2, card_number),
            approval_date = CASE WHEN $1::varchar = 'Approved' THEN CURRENT_DATE ELSE approval_date END,
            collection_office_id = CASE WHEN $1::varchar = 'Ready for Collection' THEN $3 ELSE collection_office_id END,
            ready_for_collection_at = CASE WHEN $1::varchar = 'Ready for Collection' THEN NOW() ELSE ready_for_collection_at END,
            collected_at = CASE WHEN $1::varchar = 'Collected' THEN NOW() ELSE collected_at END,
            signature_reference = CASE WHEN $1::varchar = 'Collected' THEN $5 ELSE signature_reference END,
            updated_at = NOW()
         WHERE national_id_card_id = $4`,
        [transition.to, cardNumber, officeId, record.national_id_card_id, req.body.signatureReference || null]
      );
      await syncApplicationStatus(client, { sourceTable: 'national_id_cards', sourceId: record.national_id_card_id, status: transition.to, completed: transition.to === 'Collected' });
      await client.query('COMMIT');

      const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.citizen_id])).rows[0];
      if (userRow) {
        const messages = {
          'Under Review': 'Your National ID application is now under review.',
          'Verification in Progress': 'Your identity is being verified against your Home Affairs record.',
          'Approved': 'Your National ID application has been approved.',
          'Card Production': 'Your National ID card is being produced.',
          'Ready for Collection': 'Your National ID card is ready for collection.',
          'Collected': 'Your National ID card has been marked as collected.',
        };
        await createNotification({
          userId: userRow.user_id, title: `National ID: ${transition.to}`, message: messages[transition.to] || `Status updated to ${transition.to}.`,
          type: transition.to === 'Ready for Collection' ? 'Ready for Collection' : transition.to === 'Approved' ? 'Approval' : 'Status Change',
        });
      }
      res.json({ nationalIdCardId: record.national_id_card_id, status: transition.to, cardNumber });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

/** GET /api/home-affairs/national-id/pending-biometric-captures — a police officer's own
 *  station's queue (system_administrator sees every station). This is the one new officer
 *  touchpoint the client's design adds to National ID: everything else is fully automatic. */
async function listPendingNationalIdBiometricCaptures(req, res, next) {
  try {
    if (!['police_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const isAdmin = req.user.roleKey === 'system_administrator';
    if (!isAdmin && !req.user.officeId) return res.json({ nationalIdCards: [] });
    const { rows } = await db.query(
      `SELECT n.national_id_card_id, n.application_date, n.biometric_office_id, c.first_name, c.last_name, c.date_of_birth, c.permanent_identity_number, o.name AS office_name
       FROM national_id_cards n
       JOIN citizens c ON c.citizen_id = n.citizen_id
       LEFT JOIN offices o ON o.office_id = n.biometric_office_id
       WHERE n.production_status = 'Awaiting Biometric Capture' AND ($1::boolean OR n.biometric_office_id = $2)
       ORDER BY n.application_date`,
      [isAdmin, req.user.officeId || null]
    );
    res.json({ nationalIdCards: rows });
  } catch (err) {
    next(err);
  }
}

/** POST /api/home-affairs/national-id/:id/capture-biometrics — a police officer, at the station
 *  the citizen chose, scans both hands in person (see components/HandScan.jsx on the frontend —
 *  a real geometric template, not a photo) and confirms. This is the ONLY way a National ID
 *  application's biometrics are captured for a citizen who wasn't already enrolled; it writes the
 *  template to citizen_biometrics (migration 052) exactly like a citizen's own self-enrolment
 *  does, so it is available to every other service from this point on, then auto-produces the
 *  card — see autoProduceNationalId above. */
async function captureNationalIdBiometrics(req, res, next) {
  try {
    if (!['police_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { leftHandTemplate, rightHandTemplate } = req.body;
    if (!isValidTemplate(leftHandTemplate) || !isValidTemplate(rightHandTemplate)) {
      return res.status(400).json({ error: 'A valid hand-geometry template is required for both hands.' });
    }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM national_id_cards WHERE national_id_card_id = $1 FOR UPDATE', [req.params.id]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'National ID application not found.' }); }
      const record = rows[0];
      if (record.production_status !== 'Awaiting Biometric Capture') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `This application is '${record.production_status}', not awaiting biometric capture.` });
      }
      if (req.user.roleKey !== 'system_administrator' && record.biometric_office_id !== req.user.officeId) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'This citizen chose a different police station for biometric capture.' });
      }

      await client.query(
        `INSERT INTO citizen_biometrics (citizen_id, left_hand_template, left_hand_captured_at, right_hand_template, right_hand_captured_at, enrollment_source, updated_at)
         VALUES ($1, $2, NOW(), $3, NOW(), 'Police Station Biometric Capture (National ID)', NOW())
         ON CONFLICT (citizen_id) DO UPDATE
           SET left_hand_template = EXCLUDED.left_hand_template, left_hand_captured_at = NOW(),
               right_hand_template = EXCLUDED.right_hand_template, right_hand_captured_at = NOW(),
               enrollment_source = EXCLUDED.enrollment_source, updated_at = NOW()`,
        [record.citizen_id, JSON.stringify(leftHandTemplate), JSON.stringify(rightHandTemplate)]
      );
      await client.query(
        `UPDATE national_id_cards SET biometric_captured_by_user_id = $1, biometric_captured_at = NOW(), updated_at = NOW() WHERE national_id_card_id = $2`,
        [req.user.userId, record.national_id_card_id]
      );
      const cardNumber = await autoProduceNationalId(client, record.national_id_card_id);
      await client.query('COMMIT');

      await recordAudit({
        userId: req.user.userId, departmentId: await getDepartmentId('police'), action: 'NATIONAL_ID_BIOMETRICS_CAPTURED',
        targetType: 'national_id_card', targetId: record.national_id_card_id, metadata: { citizenId: record.citizen_id },
      });
      const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.citizen_id])).rows[0];
      if (userRow) {
        await createNotification({
          userId: userRow.user_id, title: 'National ID biometrics captured',
          message: 'Your biometrics have been captured at the police station. Your National ID card has been approved and sent for production.',
          type: 'Approval',
        });
      }
      res.json({ nationalIdCardId: record.national_id_card_id, status: 'Card Production', cardNumber });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

// ============================================================================================
// DEATH REGISTRATION
// (Corrections (FR12) moved to corrections.controller.js — it was always meant to be generic
// across departments, per the comment on the `corrections` table in migration 020, but the
// code only ever worked for Home Affairs. Finance needed it too — see
// finance.controller.js/government employment — so it's now actually generic.)
// ============================================================================================

/** POST /api/home-affairs/death-registration  body: { citizenId, dateOfDeath, placeOfDeath } */
async function reportDeath(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to report a death.' });
    // A reporting citizen knows the deceased's permanent identity number, not an internal
    // database id — the same PIN-based lookup pattern used by identity verification and police.
    const { permanentIdentityNumber, dateOfDeath, placeOfDeath } = req.body;
    if (!permanentIdentityNumber || !dateOfDeath) {
      return res.status(400).json({ error: 'permanentIdentityNumber and dateOfDeath are required.' });
    }
    const { rows: citizenRows } = await db.query(
      'SELECT citizen_id, first_name, last_name, is_deceased FROM citizens WHERE permanent_identity_number = $1',
      [permanentIdentityNumber]
    );
    if (citizenRows.length === 0) {
      return res.status(404).json({ error: 'No citizen record matches that permanent identity number.' });
    }
    if (citizenRows[0].is_deceased) {
      return res.status(409).json({ error: 'A death has already been registered for this citizen.' });
    }
    const referenceNumber = generateReference('DR');
    const { rows } = await db.query(
      `INSERT INTO death_records (citizen_id, reported_by_citizen_id, registration_reference, date_of_death, place_of_death)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [citizenRows[0].citizen_id, req.user.citizenId, referenceNumber, dateOfDeath, placeOfDeath || null]
    );
    res.status(201).json({ deathRecord: rows[0], deceasedName: `${citizenRows[0].first_name} ${citizenRows[0].last_name}` });
  } catch (err) {
    next(err);
  }
}

/** POST /api/home-affairs/death-registration/:id/approve (officer) */
async function approveDeath(req, res, next) {
  try {
    if (!['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM death_records WHERE death_record_id = $1 FOR UPDATE', [req.params.id]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
      const record = rows[0];
      // The certificate is minted in this same step — no separate "Death Certificate Issuance"
      // request needed any more (that service has been removed; see migration 058). This mirrors
      // how Birth Certificate already works: the certificate_number is assigned the moment the
      // underlying record is approved, not on a later, separate ask.
      const certificateNumber = generateReference('DC');
      await client.query(
        `UPDATE death_records SET status = 'Approved', handling_officer_id = $1, approved_at = NOW(),
            certificate_number = $2, certificate_issued_at = NOW(), updated_at = NOW() WHERE death_record_id = $3`,
        [req.user.userId, certificateNumber, record.death_record_id]
      );
      await client.query(`UPDATE citizens SET is_deceased = TRUE, date_of_death = $1, updated_at = NOW() WHERE citizen_id = $2`, [record.date_of_death, record.citizen_id]);
      // Every pension of the deceased stops automatically in this same step — not just a
      // notification for an officer to act on later. 'Rejected' records never took effect and
      // 'Stopped (Deceased)' ones are already stopped, so both are left alone; everything else
      // (including an ongoing 'Completed' pension) is stopped now.
      const { rows: stoppedPensions } = await client.query(
        `UPDATE pension_records SET status = 'Stopped (Deceased)', life_status = 'Deceased', updated_at = NOW()
         WHERE citizen_id = $1 AND status NOT IN ('Rejected', 'Stopped (Deceased)') RETURNING pension_record_id`,
        [record.citizen_id]
      );
      for (const stopped of stoppedPensions) {
        // eslint-disable-next-line no-await-in-loop
        await syncApplicationStatus(client, { sourceTable: 'pension_records', sourceId: stopped.pension_record_id, status: 'Stopped (Deceased)', completed: true, note: 'Stopped automatically — death registration approved.' });
      }
      // Controlled notification to Pensions (per the report's design: a death registration
      // creates a notification for authorised pension officials, it does not expose the case elsewhere).
      const { rows: pensionOfficers } = await client.query(
        `SELECT u.user_id FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_key = 'pensions_officer'`
      );
      for (const officer of pensionOfficers) {
        // eslint-disable-next-line no-await-in-loop
        await createNotification({
          userId: officer.user_id, title: 'Death registration recorded',
          message: stoppedPensions.length > 0
            ? `A death has been registered (ref ${record.registration_reference}). ${stoppedPensions.length} pension record(s) for this citizen have been stopped automatically.`
            : `A death has been registered for a citizen (ref ${record.registration_reference}). No active pension record was found.`,
          type: 'System',
        });
      }
      await client.query('COMMIT');
      await recordAudit({ userId: req.user.userId, departmentId: await getDepartmentId('home_affairs'), action: 'DEATH_REGISTRATION_APPROVED', targetType: 'death_record', targetId: record.death_record_id, metadata: { certificateNumber } });
      const { rows: reporterUserRows } = await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.reported_by_citizen_id]);
      if (reporterUserRows[0]) {
        await createNotification({
          userId: reporterUserRows[0].user_id, title: 'Death certificate issued',
          message: `The death registration ${record.registration_reference} has been approved. Certificate number: ${certificateNumber}. You can view and print it now.`,
          type: 'Approval',
        });
      }
      res.json({ deathRecordId: record.death_record_id, status: 'Approved', certificateNumber });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

// ============================================================================================
// DEATH REGISTRATION — reportDeath/approveDeath existed already; list/get were missing
// entirely, which is why this service had no frontend at all despite working backend logic.
// ============================================================================================

/** GET /api/home-affairs/death-registration — citizen: deaths they reported. Officer: queue. */
async function listDeathRegistrations(req, res, next) {
  try {
    if (['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey)) {
      const { rows } = await db.query(
        `SELECT dr.*, c.first_name, c.last_name, c.permanent_identity_number,
                rc.first_name AS reporter_first_name, rc.last_name AS reporter_last_name
         FROM death_records dr
         JOIN citizens c ON c.citizen_id = dr.citizen_id
         JOIN citizens rc ON rc.citizen_id = dr.reported_by_citizen_id
         ORDER BY dr.submitted_at DESC`
      );
      return res.json({ deathRegistrations: rows });
    }
    if (!req.user.citizenId) return res.json({ deathRegistrations: [] });
    const { rows } = await db.query(
      `SELECT dr.*, c.first_name, c.last_name, c.permanent_identity_number
       FROM death_records dr JOIN citizens c ON c.citizen_id = dr.citizen_id
       WHERE dr.reported_by_citizen_id = $1 ORDER BY dr.submitted_at DESC`,
      [req.user.citizenId]
    );
    res.json({ deathRegistrations: rows });
  } catch (err) { next(err); }
}

/** GET /api/home-affairs/death-registration/:id */
async function getDeathRegistration(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT dr.*, c.first_name, c.middle_name, c.last_name, c.permanent_identity_number, c.date_of_birth, c.sex,
              rc.first_name AS reporter_first_name, rc.last_name AS reporter_last_name
       FROM death_records dr
       JOIN citizens c ON c.citizen_id = dr.citizen_id
       JOIN citizens rc ON rc.citizen_id = dr.reported_by_citizen_id
       WHERE dr.death_record_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Death registration not found.' });
    const record = rows[0];
    const isReporter = req.user.citizenId && record.reported_by_citizen_id === req.user.citizenId;
    const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey);
    if (!isReporter && !isOfficer) return res.status(403).json({ error: 'You do not have access to this record.' });
    res.json({ deathRegistration: record });
  } catch (err) { next(err); }
}

// ============================================================================================
// MARRIAGE REGISTRATION
//
// status flow: Submitted -> Under Review -> Verified -> Approved (certificate_number assigned)
//                                                     \-> Rejected
// The filer is always an already-verified citizen (spouse1's identity comes from the citizens
// table, same as birth registration's parent); spouse2 is recorded as supplied.
// ============================================================================================

async function createMarriageRegistration(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to register a marriage.' });
    const {
      spouse2Name, spouse2DateOfBirth, spouse2Nationality, spouse2PermanentIdentityNumber,
      marriageType, marriageDate, placeOfMarriage, witness1Name, witness2Name, officiantName,
      preferredOfficeId,
    } = req.body;
    if (!spouse2Name || !marriageType || !marriageDate || !placeOfMarriage || !witness1Name || !witness2Name) {
      return res.status(400).json({ error: 'spouse2Name, marriageType, marriageDate, placeOfMarriage, witness1Name and witness2Name are required.' });
    }
    if (!preferredOfficeId) return res.status(400).json({ error: 'preferredOfficeId is required.' });
    const referenceNumber = generateReference('MR');
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO marriage_records (filer_citizen_id, registration_reference, spouse2_name,
            spouse2_date_of_birth, spouse2_nationality, spouse2_permanent_identity_number,
            marriage_type, marriage_date, place_of_marriage, witness1_name, witness2_name,
            officiant_name, preferred_office_id, status, submitted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'Submitted',NOW())
         RETURNING marriage_record_id`,
        [req.user.citizenId, referenceNumber, spouse2Name, spouse2DateOfBirth || null, spouse2Nationality || 'Mosotho',
         spouse2PermanentIdentityNumber || null, marriageType, marriageDate, placeOfMarriage, witness1Name, witness2Name,
         officiantName || null, preferredOfficeId]
      );
      const marriageRecordId = rows[0].marriage_record_id;
      await indexApplication(client, {
        citizenId: req.user.citizenId, departmentKey: 'home_affairs', serviceType: 'Marriage Registration',
        referenceNumber, sourceTable: 'marriage_records', sourceId: marriageRecordId, status: 'Submitted',
      });
      await client.query('COMMIT');
      await createNotification({
        userId: req.user.userId, title: 'Marriage registration submitted',
        message: `Your marriage registration ${referenceNumber} has been submitted and is awaiting review.`,
        type: 'Application Submitted',
      });
      res.status(201).json({ marriageRecordId, referenceNumber, status: 'Submitted' });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
}

async function listMarriageRegistrations(req, res, next) {
  try {
    if (['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey)) {
      const { status } = req.query;
      const { rows } = await db.query(
        `SELECT mr.*, c.first_name AS filer_first_name, c.last_name AS filer_last_name
         FROM marriage_records mr JOIN citizens c ON c.citizen_id = mr.filer_citizen_id
         WHERE $1::text IS NULL OR mr.status = $1 ORDER BY mr.submitted_at DESC`,
        [status || null]
      );
      return res.json({ marriageRegistrations: rows });
    }
    if (!req.user.citizenId) return res.json({ marriageRegistrations: [] });
    const { rows } = await db.query(
      `SELECT * FROM marriage_records WHERE filer_citizen_id = $1 ORDER BY submitted_at DESC`,
      [req.user.citizenId]
    );
    res.json({ marriageRegistrations: rows });
  } catch (err) { next(err); }
}

async function getMarriageRegistration(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT mr.*, c.first_name AS filer_first_name, c.last_name AS filer_last_name,
              c.date_of_birth AS filer_date_of_birth, c.sex AS filer_sex,
              c.permanent_identity_number AS filer_permanent_identity_number,
              o.name AS office_name
       FROM marriage_records mr
       JOIN citizens c ON c.citizen_id = mr.filer_citizen_id
       LEFT JOIN offices o ON o.office_id = mr.preferred_office_id
       WHERE mr.marriage_record_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Marriage registration not found.' });
    const record = rows[0];
    const isOwner = req.user.citizenId && record.filer_citizen_id === req.user.citizenId;
    const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey);
    if (!isOwner && !isOfficer) return res.status(403).json({ error: 'You do not have access to this application.' });
    res.json({ marriageRegistration: record });
  } catch (err) { next(err); }
}

async function transitionMarriage(req, res, next, { from, to, sideEffect, allowOwner = false }) {
  try {
    const isOfficer = req.user.roleKey === 'home_affairs_officer' || req.user.roleKey === 'system_administrator';
    if (!isOfficer && !allowOwner) {
      return res.status(403).json({ error: 'Only Home Affairs officers can perform this action.' });
    }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM marriage_records WHERE marriage_record_id = $1 FOR UPDATE', [req.params.id]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Marriage registration not found.' }); }
      const record = rows[0];
      if (!isOfficer && record.filer_citizen_id !== req.user.citizenId) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Not your application.' });
      }
      if (Array.isArray(from) ? !from.includes(record.status) : record.status !== from) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Cannot move from '${record.status}' to '${to}'.` });
      }
      const result = await (sideEffect ? sideEffect(client, record, req) : Promise.resolve({}));
      await client.query('COMMIT');
      res.json({ marriageRecordId: record.marriage_record_id, status: result.status || to, ...result.extra });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
}

function startReviewMarriage(req, res, next) {
  return transitionMarriage(req, res, next, {
    from: 'Submitted', to: 'Under Review',
    sideEffect: async (client, record) => {
      await client.query(`UPDATE marriage_records SET status = 'Under Review', updated_at = NOW() WHERE marriage_record_id = $1`, [record.marriage_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'marriage_records', sourceId: record.marriage_record_id, status: 'Under Review' });
      return { status: 'Under Review' };
    },
  });
}

function requestInformationMarriage(req, res, next) {
  const { reason } = req.body;
  return transitionMarriage(req, res, next, {
    from: ['Under Review', 'Verified'], to: 'Additional Information Required',
    sideEffect: async (client, record) => {
      if (!reason) throw Object.assign(new Error('A reason is required.'), { status: 400 });
      await client.query(`UPDATE marriage_records SET status = 'Additional Information Required', updated_at = NOW() WHERE marriage_record_id = $1`, [record.marriage_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'marriage_records', sourceId: record.marriage_record_id, status: 'Additional Information Required' });
      const userRow = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.filer_citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Additional information required', message: `Reference ${record.registration_reference}: ${reason}`, type: 'Missing Information' });
      return { status: 'Additional Information Required' };
    },
  });
}

/** POST /:id/resubmit (citizen, owner only) — Feature 4: lets the filer correct and resubmit
 *  after either Additional Information Required OR Rejected, instead of starting over. */
function resubmitMarriage(req, res, next) {
  const {
    spouse2Name, spouse2DateOfBirth, spouse2Nationality, spouse2PermanentIdentityNumber,
    marriageType, marriageDate, placeOfMarriage, witness1Name, witness2Name, officiantName,
  } = req.body;
  return transitionMarriage(req, res, next, {
    from: ['Additional Information Required', 'Rejected'], to: 'Under Review', allowOwner: true,
    sideEffect: async (client, record) => {
      if (!spouse2Name || !marriageType || !marriageDate || !placeOfMarriage || !witness1Name || !witness2Name) {
        throw Object.assign(new Error('spouse2Name, marriageType, marriageDate, placeOfMarriage, witness1Name and witness2Name are required.'), { status: 400 });
      }
      await client.query(
        `UPDATE marriage_records SET status = 'Under Review', rejection_reason = NULL,
            spouse2_name = $1, spouse2_date_of_birth = $2, spouse2_nationality = $3, spouse2_permanent_identity_number = $4,
            marriage_type = $5, marriage_date = $6, place_of_marriage = $7, witness1_name = $8, witness2_name = $9,
            officiant_name = $10, updated_at = NOW()
         WHERE marriage_record_id = $11`,
        [spouse2Name, spouse2DateOfBirth || null, spouse2Nationality || 'Mosotho', spouse2PermanentIdentityNumber || null,
         marriageType, marriageDate, placeOfMarriage, witness1Name, witness2Name, officiantName || null, record.marriage_record_id]
      );
      await syncApplicationStatus(client, { sourceTable: 'marriage_records', sourceId: record.marriage_record_id, status: 'Under Review' });
      return { status: 'Under Review' };
    },
  });
}

function verifyMarriage(req, res, next) {
  return transitionMarriage(req, res, next, {
    from: 'Under Review', to: 'Verified',
    sideEffect: async (client, record) => {
      await client.query(`UPDATE marriage_records SET status = 'Verified', updated_at = NOW() WHERE marriage_record_id = $1`, [record.marriage_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'marriage_records', sourceId: record.marriage_record_id, status: 'Verified' });
      return { status: 'Verified' };
    },
  });
}

function approveMarriage(req, res, next) {
  return transitionMarriage(req, res, next, {
    from: 'Verified', to: 'Approved',
    sideEffect: async (client, record) => {
      const certificateNumber = generateReference('MC');
      await client.query(
        `UPDATE marriage_records SET status = 'Approved', certificate_number = $1, approved_at = NOW(), updated_at = NOW() WHERE marriage_record_id = $2`,
        [certificateNumber, record.marriage_record_id]
      );
      await syncApplicationStatus(client, { sourceTable: 'marriage_records', sourceId: record.marriage_record_id, status: 'Approved', completed: true });
      await createNotification({
        userId: (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.filer_citizen_id])).rows[0]?.user_id,
        title: 'Marriage certificate issued', message: `Certificate ${certificateNumber} is ready to view.`, type: 'Approval',
      });
      return { status: 'Approved', extra: { certificateNumber } };
    },
  });
}

function rejectMarriage(req, res, next) {
  const { reason } = req.body;
  return transitionMarriage(req, res, next, {
    from: ['Submitted', 'Under Review', 'Verified'], to: 'Rejected',
    sideEffect: async (client, record) => {
      if (!reason) throw Object.assign(new Error('A reason is required.'), { status: 400 });
      await client.query(`UPDATE marriage_records SET status = 'Rejected', rejection_reason = $1, updated_at = NOW() WHERE marriage_record_id = $2`, [reason, record.marriage_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'marriage_records', sourceId: record.marriage_record_id, status: 'Rejected', completed: true });
      const userRow = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.filer_citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Marriage registration rejected', message: reason, type: 'Rejection' });
      await recordAudit({ userId: req.user.userId, departmentId: await getDepartmentId('home_affairs'), action: 'MARRIAGE_REJECTED', targetType: 'marriage_record', targetId: record.marriage_record_id, reason });
      return { status: 'Rejected' };
    },
  });
}

/** GET /api/home-affairs/marriage-certificate/:id */
async function getMarriageCertificate(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT mr.*, c.first_name AS filer_first_name, c.last_name AS filer_last_name,
              c.date_of_birth AS filer_date_of_birth, c.sex AS filer_sex,
              c.permanent_identity_number AS filer_permanent_identity_number,
              o.name AS office_name
       FROM marriage_records mr
       JOIN citizens c ON c.citizen_id = mr.filer_citizen_id
       LEFT JOIN offices o ON o.office_id = mr.preferred_office_id
       WHERE mr.marriage_record_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found.' });
    const record = rows[0];
    if (record.status !== 'Approved') return res.status(409).json({ error: 'This certificate has not been issued yet.' });
    const isOwner = req.user.citizenId && req.user.citizenId === record.filer_citizen_id;
    const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey);
    if (!isOwner && !isOfficer) return res.status(403).json({ error: 'You do not have access to this certificate.' });
    res.json({ marriageCertificate: record });
  } catch (err) { next(err); }
}

// ============================================================================================
// DIVORCE REGISTRATION
//
// Home Affairs registers a divorce that a Lesotho court has already granted — it requires the
// court's own reference rather than a stated reason, because this system administratively
// records a legal fact, it does not adjudicate one.
// status flow: Submitted -> Under Review -> Verified -> Approved (certificate_number assigned)
//                                                     \-> Rejected
// ============================================================================================

async function createDivorceRegistration(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to register a divorce.' });
    const {
      spouseName, spousePermanentIdentityNumber, marriageReference,
      courtName, courtOrderReference, divorceOrderDate, preferredOfficeId,
    } = req.body;
    if (!spouseName || !courtName || !courtOrderReference || !divorceOrderDate) {
      return res.status(400).json({ error: 'spouseName, courtName, courtOrderReference and divorceOrderDate are required.' });
    }
    if (!preferredOfficeId) return res.status(400).json({ error: 'preferredOfficeId is required.' });
    const referenceNumber = generateReference('DV');
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO divorce_records (filer_citizen_id, registration_reference, spouse_name,
            spouse_permanent_identity_number, marriage_reference, court_name, court_order_reference,
            divorce_order_date, preferred_office_id, status, submitted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Submitted',NOW())
         RETURNING divorce_record_id`,
        [req.user.citizenId, referenceNumber, spouseName, spousePermanentIdentityNumber || null,
         marriageReference || null, courtName, courtOrderReference, divorceOrderDate, preferredOfficeId]
      );
      const divorceRecordId = rows[0].divorce_record_id;
      await indexApplication(client, {
        citizenId: req.user.citizenId, departmentKey: 'home_affairs', serviceType: 'Divorce Registration',
        referenceNumber, sourceTable: 'divorce_records', sourceId: divorceRecordId, status: 'Submitted',
      });
      await client.query('COMMIT');
      await createNotification({
        userId: req.user.userId, title: 'Divorce registration submitted',
        message: `Your divorce registration ${referenceNumber} has been submitted and is awaiting review.`,
        type: 'Application Submitted',
      });
      res.status(201).json({ divorceRecordId, referenceNumber, status: 'Submitted' });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
}

async function listDivorceRegistrations(req, res, next) {
  try {
    if (['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey)) {
      const { status } = req.query;
      const { rows } = await db.query(
        `SELECT dvr.*, c.first_name AS filer_first_name, c.last_name AS filer_last_name
         FROM divorce_records dvr JOIN citizens c ON c.citizen_id = dvr.filer_citizen_id
         WHERE $1::text IS NULL OR dvr.status = $1 ORDER BY dvr.submitted_at DESC`,
        [status || null]
      );
      return res.json({ divorceRegistrations: rows });
    }
    if (!req.user.citizenId) return res.json({ divorceRegistrations: [] });
    const { rows } = await db.query(
      `SELECT * FROM divorce_records WHERE filer_citizen_id = $1 ORDER BY submitted_at DESC`,
      [req.user.citizenId]
    );
    res.json({ divorceRegistrations: rows });
  } catch (err) { next(err); }
}

async function getDivorceRegistration(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT dvr.*, c.first_name AS filer_first_name, c.last_name AS filer_last_name,
              c.permanent_identity_number AS filer_permanent_identity_number,
              o.name AS office_name
       FROM divorce_records dvr
       JOIN citizens c ON c.citizen_id = dvr.filer_citizen_id
       LEFT JOIN offices o ON o.office_id = dvr.preferred_office_id
       WHERE dvr.divorce_record_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Divorce registration not found.' });
    const record = rows[0];
    const isOwner = req.user.citizenId && record.filer_citizen_id === req.user.citizenId;
    const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey);
    if (!isOwner && !isOfficer) return res.status(403).json({ error: 'You do not have access to this application.' });
    res.json({ divorceRegistration: record });
  } catch (err) { next(err); }
}

async function transitionDivorce(req, res, next, { from, to, sideEffect, allowOwner = false }) {
  try {
    const isOfficer = req.user.roleKey === 'home_affairs_officer' || req.user.roleKey === 'system_administrator';
    if (!isOfficer && !allowOwner) {
      return res.status(403).json({ error: 'Only Home Affairs officers can perform this action.' });
    }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM divorce_records WHERE divorce_record_id = $1 FOR UPDATE', [req.params.id]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Divorce registration not found.' }); }
      const record = rows[0];
      if (!isOfficer && record.filer_citizen_id !== req.user.citizenId) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Not your application.' });
      }
      if (Array.isArray(from) ? !from.includes(record.status) : record.status !== from) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Cannot move from '${record.status}' to '${to}'.` });
      }
      const result = await (sideEffect ? sideEffect(client, record, req) : Promise.resolve({}));
      await client.query('COMMIT');
      res.json({ divorceRecordId: record.divorce_record_id, status: result.status || to, ...result.extra });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
}

function startReviewDivorce(req, res, next) {
  return transitionDivorce(req, res, next, {
    from: 'Submitted', to: 'Under Review',
    sideEffect: async (client, record) => {
      await client.query(`UPDATE divorce_records SET status = 'Under Review', updated_at = NOW() WHERE divorce_record_id = $1`, [record.divorce_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'divorce_records', sourceId: record.divorce_record_id, status: 'Under Review' });
      return { status: 'Under Review' };
    },
  });
}

function requestInformationDivorce(req, res, next) {
  const { reason } = req.body;
  return transitionDivorce(req, res, next, {
    from: ['Under Review', 'Verified'], to: 'Additional Information Required',
    sideEffect: async (client, record) => {
      if (!reason) throw Object.assign(new Error('A reason is required.'), { status: 400 });
      await client.query(`UPDATE divorce_records SET status = 'Additional Information Required', updated_at = NOW() WHERE divorce_record_id = $1`, [record.divorce_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'divorce_records', sourceId: record.divorce_record_id, status: 'Additional Information Required' });
      const userRow = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.filer_citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Additional information required', message: `Reference ${record.registration_reference}: ${reason}`, type: 'Missing Information' });
      return { status: 'Additional Information Required' };
    },
  });
}

/** POST /:id/resubmit (citizen, owner only) — Feature 4: lets the filer correct and resubmit
 *  after either Additional Information Required OR Rejected, instead of starting over. */
function resubmitDivorce(req, res, next) {
  const { spouseName, spousePermanentIdentityNumber, marriageReference, courtName, courtOrderReference, divorceOrderDate } = req.body;
  return transitionDivorce(req, res, next, {
    from: ['Additional Information Required', 'Rejected'], to: 'Under Review', allowOwner: true,
    sideEffect: async (client, record) => {
      if (!spouseName || !courtName || !courtOrderReference || !divorceOrderDate) {
        throw Object.assign(new Error('spouseName, courtName, courtOrderReference and divorceOrderDate are required.'), { status: 400 });
      }
      await client.query(
        `UPDATE divorce_records SET status = 'Under Review', rejection_reason = NULL,
            spouse_name = $1, spouse_permanent_identity_number = $2, marriage_reference = $3,
            court_name = $4, court_order_reference = $5, divorce_order_date = $6, updated_at = NOW()
         WHERE divorce_record_id = $7`,
        [spouseName, spousePermanentIdentityNumber || null, marriageReference || null, courtName, courtOrderReference, divorceOrderDate, record.divorce_record_id]
      );
      await syncApplicationStatus(client, { sourceTable: 'divorce_records', sourceId: record.divorce_record_id, status: 'Under Review' });
      return { status: 'Under Review' };
    },
  });
}

function verifyDivorce(req, res, next) {
  return transitionDivorce(req, res, next, {
    from: 'Under Review', to: 'Verified',
    sideEffect: async (client, record) => {
      await client.query(`UPDATE divorce_records SET status = 'Verified', updated_at = NOW() WHERE divorce_record_id = $1`, [record.divorce_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'divorce_records', sourceId: record.divorce_record_id, status: 'Verified' });
      return { status: 'Verified' };
    },
  });
}

function approveDivorce(req, res, next) {
  return transitionDivorce(req, res, next, {
    from: 'Verified', to: 'Approved',
    sideEffect: async (client, record) => {
      const certificateNumber = generateReference('DVC');
      await client.query(
        `UPDATE divorce_records SET status = 'Approved', certificate_number = $1, approved_at = NOW(), updated_at = NOW() WHERE divorce_record_id = $2`,
        [certificateNumber, record.divorce_record_id]
      );
      await syncApplicationStatus(client, { sourceTable: 'divorce_records', sourceId: record.divorce_record_id, status: 'Approved', completed: true });
      await createNotification({
        userId: (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.filer_citizen_id])).rows[0]?.user_id,
        title: 'Divorce certificate issued', message: `Certificate ${certificateNumber} is ready to view.`, type: 'Approval',
      });
      return { status: 'Approved', extra: { certificateNumber } };
    },
  });
}

function rejectDivorce(req, res, next) {
  const { reason } = req.body;
  return transitionDivorce(req, res, next, {
    from: ['Submitted', 'Under Review', 'Verified'], to: 'Rejected',
    sideEffect: async (client, record) => {
      if (!reason) throw Object.assign(new Error('A reason is required.'), { status: 400 });
      await client.query(`UPDATE divorce_records SET status = 'Rejected', rejection_reason = $1, updated_at = NOW() WHERE divorce_record_id = $2`, [reason, record.divorce_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'divorce_records', sourceId: record.divorce_record_id, status: 'Rejected', completed: true });
      const userRow = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.filer_citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Divorce registration rejected', message: reason, type: 'Rejection' });
      await recordAudit({ userId: req.user.userId, departmentId: await getDepartmentId('home_affairs'), action: 'DIVORCE_REJECTED', targetType: 'divorce_record', targetId: record.divorce_record_id, reason });
      return { status: 'Rejected' };
    },
  });
}

/** GET /api/home-affairs/divorce-certificate/:id */
async function getDivorceCertificate(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT dvr.*, c.first_name AS filer_first_name, c.last_name AS filer_last_name,
              c.permanent_identity_number AS filer_permanent_identity_number,
              o.name AS office_name
       FROM divorce_records dvr
       JOIN citizens c ON c.citizen_id = dvr.filer_citizen_id
       LEFT JOIN offices o ON o.office_id = dvr.preferred_office_id
       WHERE dvr.divorce_record_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found.' });
    const record = rows[0];
    if (record.status !== 'Approved') return res.status(409).json({ error: 'This certificate has not been issued yet.' });
    const isOwner = req.user.citizenId && req.user.citizenId === record.filer_citizen_id;
    const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey);
    if (!isOwner && !isOfficer) return res.status(403).json({ error: 'You do not have access to this certificate.' });
    res.json({ divorceCertificate: record });
  } catch (err) { next(err); }
}

module.exports = {
  createBirthRegistration, applyForBirthCertificatePublic, listBirthRegistrations, getBirthRegistration,
  startReviewBirthRegistration, requestInformationBirthRegistration, resubmitBirthRegistration,
  verifyBirthRegistration, confirmVerificationBirthRegistration, approveBirthRegistration, rejectBirthRegistration,
  getBirthCertificate, markCertificateReadyForCollection, collectBirthCertificate,
  listPendingParentConfirmations, confirmParentage, disputeParentage, listParentageDisputes, resolveParentageDispute, correctParentageDispute,
  applyNationalId, applyNationalIdRenewalReplacement, listNationalId, getNationalId, transitionNationalId,
  getNationalIdEligibility, listPendingNationalIdBiometricCaptures, captureNationalIdBiometrics,
  reportDeath, approveDeath, listDeathRegistrations, getDeathRegistration,
  createMarriageRegistration, listMarriageRegistrations, getMarriageRegistration,
  startReviewMarriage, requestInformationMarriage, resubmitMarriage, verifyMarriage, approveMarriage, rejectMarriage,
  getMarriageCertificate,
  createDivorceRegistration, listDivorceRegistrations, getDivorceRegistration,
  startReviewDivorce, requestInformationDivorce, resubmitDivorce, verifyDivorce, approveDivorce, rejectDivorce,
  getDivorceCertificate,
};
