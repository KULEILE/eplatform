// ============================================================================================
// CITIZENSHIP BY REGISTRATION (MARRIAGE TO A LESOTHO CITIZEN) — Home Affairs, migration 079.
//
// A second, legally distinct route into citizenship alongside Citizenship by Naturalization
// (naturalization.controller.js) — see that migration's header and this one's for the statutory
// basis (section 40 of the Constitution, as substituted by the Eighth Amendment to the
// Constitution Act, 2018) and the reasoning for why this is a separate table/controller rather
// than a field on naturalization_requests.
//
// Keyed on the logged-in user's account (users.user_id), exactly like naturalization — the
// applicant has no citizens row yet. Approval creates one, sets citizenship_status = 'Registered'
// (not 'Naturalised' — the two routes stay distinguishable), and links the applicant's account to
// it, the same moment every other department's services unlock.
// ============================================================================================

const db = require('../config/db');
const { generateReference } = require('../utils/referenceGenerator');
const { withUniquePermanentId } = require('../utils/idGenerator');
const { createNotification } = require('../utils/notify');
const { recordAudit } = require('../utils/audit');
const { getDepartmentId } = require('../utils/lookup');
const { OFFICER_ROLES } = require('../utils/workflow');
const { isValidTemplate } = require('../utils/handMatch');

// Section 40(1)(a)/(b) and 40(2) of the Constitution, as substituted by the Eighth Amendment to
// the Constitution Act, 2018 — five years, for both the living-spouse and widow/widower cases.
const ELIGIBLE_YEARS = 5;

function yearsSince(dateValue) {
  const then = new Date(dateValue);
  const now = new Date();
  let years = now.getFullYear() - then.getFullYear();
  const monthDiff = now.getMonth() - then.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < then.getDate())) years -= 1;
  return years;
}

/** Normalizes a name for a lenient, tolerant comparison — not an identity check, just a sanity
 *  check against obvious typos/mismatches. The real verification is the officer's own
 *  side-by-side review in the queue (see getOne/list below, which always join the referenced
 *  marriage record in full). */
function normalizeName(value) {
  return (value || '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

function namesRoughlyMatch(applicantFirst, applicantLast, spouse2Name) {
  const applicant = normalizeName(`${applicantFirst} ${applicantLast}`);
  const spouse2 = normalizeName(spouse2Name);
  if (!applicant || !spouse2) return false;
  const applicantParts = applicant.split(' ').filter(Boolean);
  return applicantParts.every((part) => spouse2.includes(part));
}

/** Looks up the referenced, Approved marriage record, confirms it hasn't since been divorced, and
 *  returns { marriageRecord, citizenSpouse, isWidowed }. Throws a {status, message} error object
 *  otherwise (via Object.assign(new Error(...), {status})), same convention as the rest of this
 *  codebase's sideEffect functions. */
/** The raw marriage_citizenship_requests row (as selected inside transitionMarriageCitizenship)
 *  only carries marriage_record_id, not the marriage's certificate_number — that's only present
 *  on the joined rows list/get return. This looks it up on demand for resubmit/approve, which
 *  work from the raw row. */
async function certificateNumberForRecord(client, record) {
  const { rows } = await client.query('SELECT certificate_number FROM marriage_records WHERE marriage_record_id = $1', [record.marriage_record_id]);
  return rows[0]?.certificate_number || null;
}

async function resolveMarriageEvidence(client, marriageCertificateNumber, firstName, lastName) {
  if (!marriageCertificateNumber) {
    throw Object.assign(new Error('marriageCertificateNumber is required.'), { status: 400 });
  }
  const { rows: marriageRows } = await client.query(
    `SELECT * FROM marriage_records WHERE certificate_number = $1`,
    [marriageCertificateNumber]
  );
  if (marriageRows.length === 0 || marriageRows[0].status !== 'Approved') {
    throw Object.assign(new Error('No approved marriage record was found with that certificate number.'), { status: 404 });
  }
  const marriageRecord = marriageRows[0];
  if (!namesRoughlyMatch(firstName, lastName, marriageRecord.spouse2_name)) {
    throw Object.assign(new Error(
      "The name you entered doesn't match the spouse recorded on this marriage certificate. Double-check the certificate number and your details, or see a Home Affairs officer if this is an error."
    ), { status: 400 });
  }
  const { rows: divorceRows } = await client.query(
    `SELECT 1 FROM divorce_records WHERE marriage_reference = $1 AND status = 'Approved'`,
    [marriageCertificateNumber]
  );
  if (divorceRows.length > 0) {
    throw Object.assign(new Error('This marriage has since been registered as dissolved, so it cannot be used to apply for citizenship by registration.'), { status: 409 });
  }
  const { rows: citizenRows } = await client.query(`SELECT * FROM citizens WHERE citizen_id = $1`, [marriageRecord.filer_citizen_id]);
  const citizenSpouse = citizenRows[0];
  return { marriageRecord, citizenSpouse, isWidowed: !!citizenSpouse?.is_deceased };
}

/** POST /api/home-affairs/marriage-citizenship
 *  body: { marriageCertificateNumber, firstName, middleName?, lastName, dateOfBirth, placeOfBirth?,
 *          sex, nationality, travelDocumentType, travelDocumentNumber, arrivalDate,
 *          cohabitationStartDate (required unless the citizen spouse is deceased),
 *          photoReference, paymentReference?, receiptImageReference?,
 *          leftHandBiometricReference, rightHandBiometricReference, leftHandTemplate, rightHandTemplate } */
async function submitMarriageCitizenshipRequest(req, res, next) {
  try {
    if (!req.user.isForeignNational) {
      return res.status(403).json({ error: 'Only a foreign-national account can apply for Citizenship by Registration (marriage).' });
    }
    if (req.user.citizenId) {
      return res.status(409).json({ error: 'This account is already linked to a citizen record.' });
    }
    const {
      marriageCertificateNumber, firstName, middleName, lastName, dateOfBirth, placeOfBirth, sex, nationality,
      travelDocumentType, travelDocumentNumber, arrivalDate, cohabitationStartDate,
      photoReference, paymentReference, receiptImageReference,
      leftHandBiometricReference, rightHandBiometricReference, leftHandTemplate, rightHandTemplate,
    } = req.body;
    if (!firstName || !lastName || !dateOfBirth || !sex || !nationality
      || !travelDocumentType || !travelDocumentNumber || !arrivalDate) {
      return res.status(400).json({ error: 'firstName, lastName, dateOfBirth, sex, nationality, travelDocumentType, travelDocumentNumber and arrivalDate are required.' });
    }
    if (!photoReference) return res.status(400).json({ error: 'A photo is required.' });
    if (!paymentReference || !receiptImageReference) {
      return res.status(400).json({ error: 'A payment reference and receipt image are required.' });
    }
    if (!leftHandBiometricReference || !rightHandBiometricReference) {
      return res.status(400).json({ error: 'A biometric scan of both the left and right hand is required to apply for Citizenship by Registration.' });
    }
    if (!isValidTemplate(leftHandTemplate) || !isValidTemplate(rightHandTemplate)) {
      return res.status(400).json({ error: 'Both hand scans must produce a valid hand-geometry reading — retake any scan that was rejected before resubmitting.' });
    }
    const arrival = new Date(arrivalDate);
    if (Number.isNaN(arrival.getTime()) || arrival > new Date()) {
      return res.status(400).json({ error: 'arrivalDate must be a valid date in the past.' });
    }

    const { rows: existing } = await db.query(
      `SELECT 1 FROM marriage_citizenship_requests WHERE applicant_user_id = $1 AND status NOT IN ('Rejected')`,
      [req.user.userId]
    );
    if (existing.length > 0) return res.status(409).json({ error: 'You already have a citizenship-by-registration application in progress.' });

    const { marriageRecord, isWidowed } = await resolveMarriageEvidence(db, marriageCertificateNumber, firstName, lastName);

    if (!isWidowed) {
      // Section 40(1) — both legs required for a living citizen spouse.
      if (!cohabitationStartDate) {
        return res.status(400).json({ error: 'cohabitationStartDate is required — section 40(1)(a) requires five years of cohabitation in Lesotho with your spouse.' });
      }
      const cohabitation = new Date(cohabitationStartDate);
      if (Number.isNaN(cohabitation.getTime()) || cohabitation > new Date()) {
        return res.status(400).json({ error: 'cohabitationStartDate must be a valid date in the past.' });
      }
      if (yearsSince(arrivalDate) < ELIGIBLE_YEARS || yearsSince(cohabitationStartDate) < ELIGIBLE_YEARS) {
        return res.status(400).json({
          error: `You must show at least ${ELIGIBLE_YEARS} years of both continuous lawful stay in Lesotho and cohabitation with your spouse before applying. Based on the dates given, you are not yet eligible.`,
          eligibleYears: ELIGIBLE_YEARS,
        });
      }
    } else {
      // Section 40(2) — widow/widower: continuous lawful stay only, no cohabitation requirement.
      if (yearsSince(arrivalDate) < ELIGIBLE_YEARS) {
        return res.status(400).json({
          error: `As the surviving spouse of a Lesotho citizen, you must show at least ${ELIGIBLE_YEARS} years of continuous lawful stay in Lesotho before applying. Based on the arrival date given, you are not yet eligible.`,
          eligibleYears: ELIGIBLE_YEARS,
        });
      }
    }

    const requestReference = generateReference('REGCIT');
    const { rows } = await db.query(
      `INSERT INTO marriage_citizenship_requests
         (applicant_user_id, marriage_record_id, first_name, middle_name, last_name, date_of_birth, place_of_birth, sex, nationality,
          travel_document_type, travel_document_number, arrival_date, cohabitation_start_date,
          photo_reference, payment_reference, receipt_image_reference, request_reference,
          left_hand_biometric_reference, right_hand_biometric_reference, left_hand_template, right_hand_template)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
      [req.user.userId, marriageRecord.marriage_record_id, firstName, middleName || null, lastName, dateOfBirth, placeOfBirth || null, sex, nationality,
        travelDocumentType, travelDocumentNumber, arrivalDate, isWidowed ? null : cohabitationStartDate,
        photoReference, paymentReference, receiptImageReference, requestReference,
        leftHandBiometricReference, rightHandBiometricReference, JSON.stringify(leftHandTemplate), JSON.stringify(rightHandTemplate)]
    );
    await createNotification({
      userId: req.user.userId, title: 'Citizenship by registration application submitted',
      message: `Your application ${requestReference} has been sent to a Home Affairs officer for review.`,
      type: 'Application Submitted',
    });
    res.status(201).json({ marriageCitizenshipRequest: rows[0] });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

function withJoins(whereClause) {
  return `SELECT mcr.*, m.registration_reference AS marriage_registration_reference, m.certificate_number AS marriage_certificate_number,
            m.marriage_date, m.marriage_type, m.spouse2_name, m.filer_citizen_id AS citizen_spouse_id,
            cs.first_name AS citizen_spouse_first_name, cs.last_name AS citizen_spouse_last_name,
            cs.permanent_identity_number AS citizen_spouse_permanent_identity_number,
            cs.is_deceased AS citizen_spouse_is_deceased,
            c.permanent_identity_number AS resulting_permanent_identity_number
          FROM marriage_citizenship_requests mcr
          JOIN marriage_records m ON m.marriage_record_id = mcr.marriage_record_id
          LEFT JOIN citizens cs ON cs.citizen_id = m.filer_citizen_id
          LEFT JOIN citizens c ON c.citizen_id = mcr.resulting_citizen_id
          ${whereClause}`;
}

/** GET /api/home-affairs/marriage-citizenship — officer: full queue. Applicant: own requests only. */
async function listMarriageCitizenshipRequests(req, res, next) {
  try {
    if (OFFICER_ROLES.includes(req.user.roleKey)) {
      const { rows } = await db.query(`${withJoins('')} ORDER BY mcr.requested_at DESC`);
      return res.json({ marriageCitizenshipRequests: rows });
    }
    const { rows } = await db.query(`${withJoins('WHERE mcr.applicant_user_id = $1')} ORDER BY mcr.requested_at DESC`, [req.user.userId]);
    res.json({ marriageCitizenshipRequests: rows });
  } catch (err) { next(err); }
}

/** GET /api/home-affairs/marriage-citizenship/:id */
async function getMarriageCitizenshipRequest(req, res, next) {
  try {
    const { rows } = await db.query(`${withJoins('WHERE mcr.marriage_citizenship_request_id = $1')}`, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Citizenship by registration application not found.' });
    const record = rows[0];
    if (!OFFICER_ROLES.includes(req.user.roleKey) && record.applicant_user_id !== req.user.userId) {
      return res.status(403).json({ error: 'You do not have access to this application.' });
    }
    res.json({ marriageCitizenshipRequest: record });
  } catch (err) { next(err); }
}

/** Bespoke transition helper, same reasoning as naturalization.controller.js's
 *  transitionNaturalization — ownership is checked against applicant_user_id/req.user.userId. */
async function transitionMarriageCitizenship(req, res, next, { from, to, allowOwner = false, sideEffect }) {
  try {
    const isOfficerUser = OFFICER_ROLES.includes(req.user.roleKey);
    if (!isOfficerUser && !allowOwner) return res.status(403).json({ error: 'Officer only.' });
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM marriage_citizenship_requests WHERE marriage_citizenship_request_id = $1 FOR UPDATE', [req.params.id]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Citizenship by registration application not found.' }); }
      const record = rows[0];
      if (!isOfficerUser && record.applicant_user_id !== req.user.userId) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Not your application.' });
      }
      if (Array.isArray(from) ? !from.includes(record.status) : record.status !== from) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Cannot move from '${record.status}' to '${to}'.` });
      }
      const result = await (sideEffect ? sideEffect(client, record, req) : Promise.resolve({}));
      await client.query('COMMIT');
      res.json({ marriageCitizenshipRequestId: record.marriage_citizenship_request_id, status: (result && result.status) || to, ...((result && result.extra) || {}) });
    } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

/** POST /api/home-affairs/marriage-citizenship/:id/start-review — officer only. */
function startReviewMarriageCitizenship(req, res, next) {
  return transitionMarriageCitizenship(req, res, next, {
    from: 'Submitted', to: 'Under Review',
    sideEffect: async (client, record) => {
      await client.query(`UPDATE marriage_citizenship_requests SET status = 'Under Review', updated_at = NOW() WHERE marriage_citizenship_request_id = $1`, [record.marriage_citizenship_request_id]);
      return { status: 'Under Review' };
    },
  });
}

/** POST /api/home-affairs/marriage-citizenship/:id/request-information  body: { reason } — officer only. */
function requestInformationMarriageCitizenship(req, res, next) {
  const { reason } = req.body;
  return transitionMarriageCitizenship(req, res, next, {
    from: ['Under Review'], to: 'Additional Information Required',
    sideEffect: async (client, record) => {
      if (!reason) throw Object.assign(new Error('A reason is required.'), { status: 400 });
      await client.query(`UPDATE marriage_citizenship_requests SET status = 'Additional Information Required', updated_at = NOW() WHERE marriage_citizenship_request_id = $1`, [record.marriage_citizenship_request_id]);
      await createNotification({ userId: record.applicant_user_id, title: 'Additional information required', message: `Reference ${record.request_reference}: ${reason}`, type: 'Missing Information' });
      return { status: 'Additional Information Required' };
    },
  });
}

/** POST /api/home-affairs/marriage-citizenship/:id/resubmit — applicant edits and resubmits. */
function resubmitMarriageCitizenship(req, res, next) {
  const {
    marriageCertificateNumber, firstName, middleName, lastName, dateOfBirth, placeOfBirth, sex, nationality,
    travelDocumentType, travelDocumentNumber, arrivalDate, cohabitationStartDate,
    photoReference, paymentReference, receiptImageReference,
    leftHandBiometricReference, rightHandBiometricReference, leftHandTemplate, rightHandTemplate,
  } = req.body;
  return transitionMarriageCitizenship(req, res, next, {
    from: ['Additional Information Required', 'Rejected'], to: 'Under Review', allowOwner: true,
    sideEffect: async (client, record) => {
      if (!firstName || !lastName || !dateOfBirth || !sex || !nationality
        || !travelDocumentType || !travelDocumentNumber || !arrivalDate) {
        throw Object.assign(new Error('firstName, lastName, dateOfBirth, sex, nationality, travelDocumentType, travelDocumentNumber and arrivalDate are required.'), { status: 400 });
      }
      if ((leftHandTemplate && !isValidTemplate(leftHandTemplate)) || (rightHandTemplate && !isValidTemplate(rightHandTemplate))) {
        throw Object.assign(new Error('A re-scanned hand must produce a valid hand-geometry reading — retake it before resubmitting.'), { status: 400 });
      }
      const { marriageRecord, isWidowed } = await resolveMarriageEvidence(client, marriageCertificateNumber || await certificateNumberForRecord(client, record), firstName, lastName);
      if (!isWidowed) {
        const cohabitationToCheck = cohabitationStartDate || record.cohabitation_start_date;
        if (!cohabitationToCheck) {
          throw Object.assign(new Error('cohabitationStartDate is required — section 40(1)(a) requires five years of cohabitation in Lesotho with your spouse.'), { status: 400 });
        }
        if (yearsSince(arrivalDate) < ELIGIBLE_YEARS || yearsSince(cohabitationToCheck) < ELIGIBLE_YEARS) {
          throw Object.assign(new Error(`You must show at least ${ELIGIBLE_YEARS} years of both continuous lawful stay in Lesotho and cohabitation with your spouse before applying.`), { status: 400 });
        }
      } else if (yearsSince(arrivalDate) < ELIGIBLE_YEARS) {
        throw Object.assign(new Error(`As the surviving spouse of a Lesotho citizen, you must show at least ${ELIGIBLE_YEARS} years of continuous lawful stay in Lesotho before applying.`), { status: 400 });
      }
      await client.query(
        `UPDATE marriage_citizenship_requests SET status = 'Under Review', rejection_reason = NULL,
            marriage_record_id = $1, first_name = $2, middle_name = $3, last_name = $4, date_of_birth = $5, place_of_birth = $6, sex = $7, nationality = $8,
            travel_document_type = $9, travel_document_number = $10, arrival_date = $11, cohabitation_start_date = $12,
            photo_reference = $13, payment_reference = $14, receipt_image_reference = $15,
            left_hand_biometric_reference = $16, right_hand_biometric_reference = $17,
            left_hand_template = $18, right_hand_template = $19, updated_at = NOW()
         WHERE marriage_citizenship_request_id = $20`,
        [marriageRecord.marriage_record_id, firstName, middleName || null, lastName, dateOfBirth, placeOfBirth || null, sex, nationality,
          travelDocumentType, travelDocumentNumber, arrivalDate, isWidowed ? null : (cohabitationStartDate || record.cohabitation_start_date),
          photoReference || record.photo_reference,
          paymentReference || record.payment_reference, receiptImageReference || record.receipt_image_reference,
          leftHandBiometricReference || record.left_hand_biometric_reference,
          rightHandBiometricReference || record.right_hand_biometric_reference,
          JSON.stringify(leftHandTemplate || record.left_hand_template),
          JSON.stringify(rightHandTemplate || record.right_hand_template),
          record.marriage_citizenship_request_id]
      );
      return { status: 'Under Review' };
    },
  });
}

/** POST /api/home-affairs/marriage-citizenship/:id/approve — officer only. Creates the new
 *  citizens row (citizenship_status = 'Registered') and links the applicant's account to it. */
function approveMarriageCitizenship(req, res, next) {
  return transitionMarriageCitizenship(req, res, next, {
    from: ['Under Review'], to: 'Approved',
    sideEffect: async (client, record, req2) => {
      // Defensive re-check, same precedent as naturalization's approveNaturalization: eligibility
      // (and that the marriage hasn't since been dissolved) is re-verified as of today.
      const { isWidowed } = await resolveMarriageEvidence(client, await certificateNumberForRecord(client, record), record.first_name, record.last_name);
      if (!isWidowed) {
        if (yearsSince(record.arrival_date) < ELIGIBLE_YEARS || yearsSince(record.cohabitation_start_date) < ELIGIBLE_YEARS) {
          throw Object.assign(new Error(`This applicant does not yet meet the ${ELIGIBLE_YEARS}-year cohabitation/residency requirement.`), { status: 409 });
        }
      } else if (yearsSince(record.arrival_date) < ELIGIBLE_YEARS) {
        throw Object.assign(new Error(`This applicant does not yet meet the ${ELIGIBLE_YEARS}-year residency requirement.`), { status: 409 });
      }

      const citizenId = await withUniquePermanentId(record.date_of_birth, async (candidatePin) => {
        const { rows: newCitizenRows } = await client.query(
          `INSERT INTO citizens (permanent_identity_number, first_name, middle_name, last_name,
              date_of_birth, place_of_birth, sex, citizenship_status, identity_verification_status, is_demo_data)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'Registered','Verified',TRUE) RETURNING citizen_id`,
          [candidatePin, record.first_name, record.middle_name, record.last_name,
            record.date_of_birth, record.place_of_birth, record.sex]
        );
        return newCitizenRows[0].citizen_id;
      });

      const certificateNumber = generateReference('REG');
      await client.query(
        `UPDATE marriage_citizenship_requests
         SET status = 'Approved', resulting_citizen_id = $1, certificate_number = $2,
             reviewed_by_user_id = $3, reviewed_at = NOW(), updated_at = NOW()
         WHERE marriage_citizenship_request_id = $4`,
        [citizenId, certificateNumber, req2.user.userId, record.marriage_citizenship_request_id]
      );
      await client.query(
        `INSERT INTO citizen_biometrics (citizen_id, left_hand_template, left_hand_captured_at, right_hand_template, right_hand_captured_at, enrollment_source, updated_at)
         VALUES ($1,$2,NOW(),$3,NOW(),'Marriage Citizenship',NOW())
         ON CONFLICT (citizen_id) DO UPDATE
           SET left_hand_template = EXCLUDED.left_hand_template, left_hand_captured_at = NOW(),
               right_hand_template = EXCLUDED.right_hand_template, right_hand_captured_at = NOW(),
               enrollment_source = EXCLUDED.enrollment_source, updated_at = NOW()`,
        [citizenId, JSON.stringify(record.left_hand_template), JSON.stringify(record.right_hand_template)]
      );
      await client.query(
        `UPDATE users SET citizen_id = $1, is_provisional = FALSE, updated_at = NOW() WHERE user_id = $2`,
        [citizenId, record.applicant_user_id]
      );

      await recordAudit({
        userId: req2.user.userId, departmentId: await getDepartmentId('home_affairs'),
        action: 'MARRIAGE_CITIZENSHIP_APPROVED', targetType: 'marriage_citizenship_request', targetId: record.marriage_citizenship_request_id,
        metadata: { citizenId, certificateNumber },
      });
      await createNotification({
        userId: record.applicant_user_id, title: 'Citizenship granted',
        message: `Congratulations — your application ${record.request_reference} has been approved. Your certificate number is ${certificateNumber}. You now have full access to government services.`,
        type: 'Approval',
      });
      return { status: 'Approved', extra: { citizenId, certificateNumber } };
    },
  });
}

/** POST /api/home-affairs/marriage-citizenship/:id/reject  body: { reason } — officer only. */
function rejectMarriageCitizenship(req, res, next) {
  const { reason } = req.body;
  return transitionMarriageCitizenship(req, res, next, {
    from: ['Submitted', 'Under Review', 'Additional Information Required'], to: 'Rejected',
    sideEffect: async (client, record, req2) => {
      if (!reason) throw Object.assign(new Error('A rejection reason is required.'), { status: 400 });
      await client.query(
        `UPDATE marriage_citizenship_requests SET status = 'Rejected', rejection_reason = $1, reviewed_by_user_id = $2, reviewed_at = NOW(), updated_at = NOW() WHERE marriage_citizenship_request_id = $3`,
        [reason, req2.user.userId, record.marriage_citizenship_request_id]
      );
      await createNotification({
        userId: record.applicant_user_id, title: 'Citizenship by registration application rejected',
        message: `Reference ${record.request_reference}: ${reason}. You can submit a new application with corrected details.`,
        type: 'Rejection',
      });
      return { status: 'Rejected' };
    },
  });
}

module.exports = {
  ELIGIBLE_YEARS,
  submitMarriageCitizenshipRequest, listMarriageCitizenshipRequests, getMarriageCitizenshipRequest,
  startReviewMarriageCitizenship, requestInformationMarriageCitizenship, resubmitMarriageCitizenship,
  approveMarriageCitizenship, rejectMarriageCitizenship,
};
