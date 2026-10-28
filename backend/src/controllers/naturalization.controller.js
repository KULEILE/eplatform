// ============================================================================================
// CITIZENSHIP BY NATURALIZATION — Home Affairs, migration 051.
//
// A foreign national who has lived in Lesotho for at least ELIGIBLE_RESIDENCY_YEARS may apply
// to become a Lesotho citizen. Keyed on the logged-in user's account (users.user_id), not a
// citizens row, since by definition the applicant has none yet — same reason
// foreign_identity_enrolments (migration 041) does not use utils/workflow.js's buildTransition()
// or the generic `applications` index (which requires a NOT NULL citizen_id). See
// transitionNaturalization() below, modelled directly on
// homeAffairsServices2.controller.js's transitionForeignIdentity().
//
// Approval is the one step that's genuinely new: instead of just assigning a reference number,
// it creates a brand-new citizens row (via the same withUniquePermanentId() mechanism birth
// registration approval uses) and links the applicant's account to it — from that moment on,
// req.user.citizenId is set and every other department's services unlock, exactly like any
// other citizen. is_foreign_national on the account is left TRUE permanently afterwards, as a
// historical record of how this citizen came to be one; nothing in the system keys access off
// that flag once citizenId is set.
// ============================================================================================

const db = require('../config/db');
const { generateReference } = require('../utils/referenceGenerator');
const { withUniquePermanentId } = require('../utils/idGenerator');
const { createNotification } = require('../utils/notify');
const { recordAudit } = require('../utils/audit');
const { getDepartmentId } = require('../utils/lookup');
const { OFFICER_ROLES } = require('../utils/workflow');
const { isValidTemplate } = require('../utils/handMatch');

// See the brief this prototype was built from: the applicant must have lived in Lesotho for at
// least this many years before they may apply. Kept as a single named constant — change this
// one value if the residency requirement is ever revisited (see migration 051's header comment
// for the real-world discrepancy between this figure and Lesotho's 1991 Citizenship (Amendment)
// Order No. 12, which is widely cited as having raised the ordinary requirement to 10 years).
const ELIGIBLE_RESIDENCY_YEARS = 5;

function yearsSince(dateValue) {
  const then = new Date(dateValue);
  const now = new Date();
  let years = now.getFullYear() - then.getFullYear();
  const monthDiff = now.getMonth() - then.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < then.getDate())) years -= 1;
  return years;
}

/** POST /api/home-affairs/naturalization
 *  body: { firstName, middleName?, lastName, dateOfBirth, placeOfBirth?, sex, nationality,
 *          travelDocumentType, travelDocumentNumber, immigrationStatus, arrivalDate,
 *          photoReference, chiefLetterReference, paymentReference?, receiptImageReference?,
 *          leftHandBiometricReference, rightHandBiometricReference, leftHandTemplate, rightHandTemplate }
 *
 *  Only a foreign-national account with no citizen_id yet may apply — not an ordinary citizen
 *  (who has no need to), and not a provisional account either, since a provisional account is
 *  claiming an EXISTING Mosotho identity and belongs in Identity Verification instead.
 *
 *  Hand-biometric capture is required here, same as National ID/Driving Licence applications —
 *  this applicant has no citizen_id yet, so the real hand-geometry templates (see
 *  frontend/src/utils/handGeometry.js) can't be enrolled to citizen_biometrics until one exists.
 *  They're held on this row instead and copied over by approveNaturalization below, the moment
 *  a citizen_id is actually minted. */
async function submitNaturalizationRequest(req, res, next) {
  try {
    if (!req.user.isForeignNational) {
      return res.status(403).json({ error: 'Only a foreign-national account can apply for Citizenship by Naturalization.' });
    }
    if (req.user.citizenId) {
      return res.status(409).json({ error: 'This account is already linked to a citizen record.' });
    }
    const {
      firstName, middleName, lastName, dateOfBirth, placeOfBirth, sex, nationality,
      travelDocumentType, travelDocumentNumber, immigrationStatus, arrivalDate,
      photoReference, chiefLetterReference, paymentReference, receiptImageReference,
      leftHandBiometricReference, rightHandBiometricReference, leftHandTemplate, rightHandTemplate,
    } = req.body;
    if (!firstName || !lastName || !dateOfBirth || !sex || !nationality
      || !travelDocumentType || !travelDocumentNumber || !immigrationStatus || !arrivalDate) {
      return res.status(400).json({ error: 'firstName, lastName, dateOfBirth, sex, nationality, travelDocumentType, travelDocumentNumber, immigrationStatus and arrivalDate are required.' });
    }
    // Studying or working in Lesotho does not by itself qualify someone for citizenship by
    // naturalization, however long they've been here — a Work/Study Permit Holder's stay is
    // non-immigrant/temporary in character. Refugee, Asylum Seeker and Permanent Resident remain
    // eligible, as does Other. If their status later changes to Permanent Resident, they become
    // eligible then. (This does not affect Citizenship by Registration via marriage to a Lesotho
    // citizen — see marriageCitizenship.controller.js — which is a separate legal basis.)
    if (immigrationStatus === 'Work Permit Holder' || immigrationStatus === 'Study Permit Holder') {
      return res.status(400).json({
        error: 'Studying or working in Lesotho does not by itself qualify you for citizenship by naturalization. You may become eligible if your status changes to Permanent Resident.',
      });
    }
    if (!photoReference) return res.status(400).json({ error: 'A photo is required.' });
    if (!chiefLetterReference) return res.status(400).json({ error: "A chief's letter confirming your residency is required." });
    if (!paymentReference || !receiptImageReference) {
      return res.status(400).json({ error: 'A payment reference and receipt image are required.' });
    }
    if (!leftHandBiometricReference || !rightHandBiometricReference) {
      return res.status(400).json({ error: 'A biometric scan of both the left and right hand is required to apply for Citizenship by Naturalization.' });
    }
    if (!isValidTemplate(leftHandTemplate) || !isValidTemplate(rightHandTemplate)) {
      return res.status(400).json({ error: 'Both hand scans must produce a valid hand-geometry reading — retake any scan that was rejected before resubmitting.' });
    }

    const arrival = new Date(arrivalDate);
    if (Number.isNaN(arrival.getTime()) || arrival > new Date()) {
      return res.status(400).json({ error: 'arrivalDate must be a valid date in the past.' });
    }
    const yearsInLesotho = yearsSince(arrivalDate);
    if (yearsInLesotho < ELIGIBLE_RESIDENCY_YEARS) {
      return res.status(400).json({
        error: `You must have lived in Lesotho for at least ${ELIGIBLE_RESIDENCY_YEARS} years before applying. Based on the arrival date given, you are not yet eligible.`,
        yearsInLesotho, eligibleResidencyYears: ELIGIBLE_RESIDENCY_YEARS,
      });
    }

    const { rows: existing } = await db.query(
      `SELECT 1 FROM naturalization_requests WHERE applicant_user_id = $1 AND status NOT IN ('Rejected')`,
      [req.user.userId]
    );
    if (existing.length > 0) return res.status(409).json({ error: 'You already have a naturalization application in progress.' });

    const requestReference = generateReference('NAT');
    const { rows } = await db.query(
      `INSERT INTO naturalization_requests
         (applicant_user_id, first_name, middle_name, last_name, date_of_birth, place_of_birth, sex, nationality,
          travel_document_type, travel_document_number, immigration_status, arrival_date,
          photo_reference, chief_letter_reference, payment_reference, receipt_image_reference, request_reference,
          left_hand_biometric_reference, right_hand_biometric_reference, left_hand_template, right_hand_template)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
      [req.user.userId, firstName, middleName || null, lastName, dateOfBirth, placeOfBirth || null, sex, nationality,
        travelDocumentType, travelDocumentNumber, immigrationStatus, arrivalDate,
        photoReference, chiefLetterReference, paymentReference, receiptImageReference, requestReference,
        leftHandBiometricReference, rightHandBiometricReference, JSON.stringify(leftHandTemplate), JSON.stringify(rightHandTemplate)]
    );
    await createNotification({
      userId: req.user.userId, title: 'Naturalization application submitted',
      message: `Your application ${requestReference} has been sent to a Home Affairs officer for review.`,
      type: 'Application Submitted',
    });
    res.status(201).json({ naturalizationRequest: rows[0] });
  } catch (err) { next(err); }
}

/** GET /api/home-affairs/naturalization — officer: full queue. Applicant: own requests only. */
async function listNaturalizationRequests(req, res, next) {
  try {
    if (OFFICER_ROLES.includes(req.user.roleKey)) {
      const { rows } = await db.query(
        `SELECT n.*, u.email AS applicant_email, u.phone AS applicant_phone, c.permanent_identity_number AS resulting_permanent_identity_number
         FROM naturalization_requests n
         JOIN users u ON u.user_id = n.applicant_user_id
         LEFT JOIN citizens c ON c.citizen_id = n.resulting_citizen_id
         ORDER BY n.requested_at DESC`
      );
      return res.json({ naturalizationRequests: rows });
    }
    const { rows } = await db.query(
      `SELECT n.*, c.permanent_identity_number AS resulting_permanent_identity_number
       FROM naturalization_requests n
       LEFT JOIN citizens c ON c.citizen_id = n.resulting_citizen_id
       WHERE n.applicant_user_id = $1 ORDER BY n.requested_at DESC`,
      [req.user.userId]
    );
    res.json({ naturalizationRequests: rows });
  } catch (err) { next(err); }
}

/** GET /api/home-affairs/naturalization/:id */
async function getNaturalizationRequest(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT n.*, c.permanent_identity_number AS resulting_permanent_identity_number
       FROM naturalization_requests n LEFT JOIN citizens c ON c.citizen_id = n.resulting_citizen_id
       WHERE n.naturalization_request_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Naturalization application not found.' });
    const record = rows[0];
    if (!OFFICER_ROLES.includes(req.user.roleKey) && record.applicant_user_id !== req.user.userId) {
      return res.status(403).json({ error: 'You do not have access to this application.' });
    }
    res.json({ naturalizationRequest: record });
  } catch (err) { next(err); }
}

/** Bespoke transition helper for this service — ownership is checked against
 *  applicant_user_id/req.user.userId rather than citizen_id/req.user.citizenId (the applicant
 *  has no citizen_id yet), so this cannot reuse utils/workflow.js's buildTransition() as
 *  written — same reasoning as homeAffairsServices2.controller.js's transitionForeignIdentity(). */
async function transitionNaturalization(req, res, next, { from, to, allowOwner = false, sideEffect }) {
  try {
    const isOfficerUser = OFFICER_ROLES.includes(req.user.roleKey);
    if (!isOfficerUser && !allowOwner) return res.status(403).json({ error: 'Officer only.' });
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM naturalization_requests WHERE naturalization_request_id = $1 FOR UPDATE', [req.params.id]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Naturalization application not found.' }); }
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
      res.json({ naturalizationRequestId: record.naturalization_request_id, status: (result && result.status) || to, ...((result && result.extra) || {}) });
    } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  } catch (err) { next(err); }
}

/** POST /api/home-affairs/naturalization/:id/start-review — officer only. */
function startReviewNaturalization(req, res, next) {
  return transitionNaturalization(req, res, next, {
    from: 'Submitted', to: 'Under Review',
    sideEffect: async (client, record) => {
      await client.query(`UPDATE naturalization_requests SET status = 'Under Review', updated_at = NOW() WHERE naturalization_request_id = $1`, [record.naturalization_request_id]);
      return { status: 'Under Review' };
    },
  });
}

/** POST /api/home-affairs/naturalization/:id/request-information  body: { reason } — officer only. */
function requestInformationNaturalization(req, res, next) {
  const { reason } = req.body;
  return transitionNaturalization(req, res, next, {
    from: ['Under Review'], to: 'Additional Information Required',
    sideEffect: async (client, record) => {
      if (!reason) throw Object.assign(new Error('A reason is required.'), { status: 400 });
      await client.query(`UPDATE naturalization_requests SET status = 'Additional Information Required', updated_at = NOW() WHERE naturalization_request_id = $1`, [record.naturalization_request_id]);
      await createNotification({ userId: record.applicant_user_id, title: 'Additional information required', message: `Reference ${record.request_reference}: ${reason}`, type: 'Missing Information' });
      return { status: 'Additional Information Required' };
    },
  });
}

/** POST /api/home-affairs/naturalization/:id/resubmit — applicant edits and resubmits. */
function resubmitNaturalization(req, res, next) {
  const {
    firstName, middleName, lastName, dateOfBirth, placeOfBirth, sex, nationality,
    travelDocumentType, travelDocumentNumber, immigrationStatus, arrivalDate,
    photoReference, chiefLetterReference, paymentReference, receiptImageReference,
    leftHandBiometricReference, rightHandBiometricReference, leftHandTemplate, rightHandTemplate,
  } = req.body;
  return transitionNaturalization(req, res, next, {
    from: ['Additional Information Required', 'Rejected'], to: 'Under Review', allowOwner: true,
    sideEffect: async (client, record) => {
      if (!firstName || !lastName || !dateOfBirth || !sex || !nationality
        || !travelDocumentType || !travelDocumentNumber || !immigrationStatus || !arrivalDate) {
        throw Object.assign(new Error('firstName, lastName, dateOfBirth, sex, nationality, travelDocumentType, travelDocumentNumber, immigrationStatus and arrivalDate are required.'), { status: 400 });
      }
      if (immigrationStatus === 'Work Permit Holder' || immigrationStatus === 'Study Permit Holder') {
        throw Object.assign(new Error('Studying or working in Lesotho does not by itself qualify you for citizenship by naturalization. You may become eligible if your status changes to Permanent Resident.'), { status: 400 });
      }
      // A re-scanned hand must itself be valid — only an UNCHANGED hand (kept from the original
      // submission, not re-scanned this time) is allowed to fall back to what's already on file.
      if ((leftHandTemplate && !isValidTemplate(leftHandTemplate)) || (rightHandTemplate && !isValidTemplate(rightHandTemplate))) {
        throw Object.assign(new Error('A re-scanned hand must produce a valid hand-geometry reading — retake it before resubmitting.'), { status: 400 });
      }
      const yearsInLesotho = yearsSince(arrivalDate);
      if (yearsInLesotho < ELIGIBLE_RESIDENCY_YEARS) {
        throw Object.assign(new Error(`You must have lived in Lesotho for at least ${ELIGIBLE_RESIDENCY_YEARS} years before applying.`), { status: 400 });
      }
      await client.query(
        `UPDATE naturalization_requests SET status = 'Under Review', rejection_reason = NULL,
            first_name = $1, middle_name = $2, last_name = $3, date_of_birth = $4, place_of_birth = $5, sex = $6, nationality = $7,
            travel_document_type = $8, travel_document_number = $9, immigration_status = $10, arrival_date = $11,
            photo_reference = $12, chief_letter_reference = $13,
            payment_reference = $14, receipt_image_reference = $15,
            left_hand_biometric_reference = $16, right_hand_biometric_reference = $17,
            left_hand_template = $18, right_hand_template = $19, updated_at = NOW()
         WHERE naturalization_request_id = $20`,
        [firstName, middleName || null, lastName, dateOfBirth, placeOfBirth || null, sex, nationality,
          travelDocumentType, travelDocumentNumber, immigrationStatus, arrivalDate,
          photoReference || record.photo_reference, chiefLetterReference || record.chief_letter_reference,
          paymentReference || record.payment_reference, receiptImageReference || record.receipt_image_reference,
          leftHandBiometricReference || record.left_hand_biometric_reference,
          rightHandBiometricReference || record.right_hand_biometric_reference,
          JSON.stringify(leftHandTemplate || record.left_hand_template),
          JSON.stringify(rightHandTemplate || record.right_hand_template),
          record.naturalization_request_id]
      );
      return { status: 'Under Review' };
    },
  });
}

/** POST /api/home-affairs/naturalization/:id/approve — officer only. Creates the new citizens
 *  row and links the applicant's account to it, exactly the moment this account gains access to
 *  the rest of the system. */
function approveNaturalization(req, res, next) {
  return transitionNaturalization(req, res, next, {
    from: ['Under Review'], to: 'Approved',
    sideEffect: async (client, record, req2) => {
      // Defensive re-check: the officer is approving residency as of today, not as of when the
      // application happened to be submitted.
      if (yearsSince(record.arrival_date) < ELIGIBLE_RESIDENCY_YEARS) {
        throw Object.assign(new Error(`This applicant does not yet meet the ${ELIGIBLE_RESIDENCY_YEARS}-year residency requirement.`), { status: 409 });
      }
      const citizenId = await withUniquePermanentId(record.date_of_birth, async (candidatePin) => {
        const { rows: newCitizenRows } = await client.query(
          `INSERT INTO citizens (permanent_identity_number, first_name, middle_name, last_name,
              date_of_birth, place_of_birth, sex, citizenship_status, identity_verification_status, is_demo_data)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'Naturalised','Verified',TRUE) RETURNING citizen_id`,
          [candidatePin, record.first_name, record.middle_name, record.last_name,
            record.date_of_birth, record.place_of_birth, record.sex]
        );
        return newCitizenRows[0].citizen_id;
      });

      const certificateNumber = generateReference('CTZ');
      await client.query(
        `UPDATE naturalization_requests
         SET status = 'Approved', resulting_citizen_id = $1, certificate_number = $2,
             reviewed_by_user_id = $3, reviewed_at = NOW(), updated_at = NOW()
         WHERE naturalization_request_id = $4`,
        [citizenId, certificateNumber, req2.user.userId, record.naturalization_request_id]
      );
      // The applicant's hand templates were captured at submission time (required above) but
      // couldn't be enrolled until a citizen_id existed to key them on — this is that moment.
      // See database/migrations/052_citizen_hand_biometrics.sql.
      await client.query(
        `INSERT INTO citizen_biometrics (citizen_id, left_hand_template, left_hand_captured_at, right_hand_template, right_hand_captured_at, enrollment_source, updated_at)
         VALUES ($1,$2,NOW(),$3,NOW(),'Naturalization',NOW())
         ON CONFLICT (citizen_id) DO UPDATE
           SET left_hand_template = EXCLUDED.left_hand_template, left_hand_captured_at = NOW(),
               right_hand_template = EXCLUDED.right_hand_template, right_hand_captured_at = NOW(),
               enrollment_source = EXCLUDED.enrollment_source, updated_at = NOW()`,
        [citizenId, JSON.stringify(record.left_hand_template), JSON.stringify(record.right_hand_template)]
      );
      // is_foreign_national is intentionally left TRUE — it's a historical fact about how this
      // citizen came to be one, not an access flag. Every service in the system keys access off
      // citizen_id, which this sets for the first time.
      await client.query(
        `UPDATE users SET citizen_id = $1, is_provisional = FALSE, updated_at = NOW() WHERE user_id = $2`,
        [citizenId, record.applicant_user_id]
      );

      await recordAudit({
        userId: req2.user.userId, departmentId: await getDepartmentId('home_affairs'),
        action: 'NATURALIZATION_APPROVED', targetType: 'naturalization_request', targetId: record.naturalization_request_id,
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

/** POST /api/home-affairs/naturalization/:id/reject  body: { reason } — officer only. */
function rejectNaturalization(req, res, next) {
  const { reason } = req.body;
  return transitionNaturalization(req, res, next, {
    from: ['Submitted', 'Under Review', 'Additional Information Required'], to: 'Rejected',
    sideEffect: async (client, record, req2) => {
      if (!reason) throw Object.assign(new Error('A rejection reason is required.'), { status: 400 });
      await client.query(
        `UPDATE naturalization_requests SET status = 'Rejected', rejection_reason = $1, reviewed_by_user_id = $2, reviewed_at = NOW(), updated_at = NOW() WHERE naturalization_request_id = $3`,
        [reason, req2.user.userId, record.naturalization_request_id]
      );
      await createNotification({
        userId: record.applicant_user_id, title: 'Naturalization application rejected',
        message: `Reference ${record.request_reference}: ${reason}. You can submit a new application with corrected details.`,
        type: 'Rejection',
      });
      return { status: 'Rejected' };
    },
  });
}

module.exports = {
  ELIGIBLE_RESIDENCY_YEARS,
  submitNaturalizationRequest, listNaturalizationRequests, getNaturalizationRequest,
  startReviewNaturalization, requestInformationNaturalization, resubmitNaturalization,
  approveNaturalization, rejectNaturalization,
};
