const db = require('../config/db');
const { generateReference } = require('../utils/referenceGenerator');
const { withUniquePermanentId } = require('../utils/idGenerator');
const { createNotification } = require('../utils/notify');
const { recordAudit } = require('../utils/audit');
const { getDepartmentId } = require('../utils/lookup');

/**
 * POST /api/identity/verify
 * Given a claimed permanent identity number + date of birth, checks whether a matching Home
 * Affairs citizen record exists. Used (a) during account registration Option A, and (b) any
 * time a department needs to confirm identity before continuing a service (e.g. National ID
 * application, passport application). Returns only the minimal safe fields a department needs
 * — never the full citizen record.
 */
async function verifyIdentity(req, res, next) {
  try {
    const { permanentIdentityNumber, dateOfBirth } = req.body;
    if (!permanentIdentityNumber || !dateOfBirth) {
      return res.status(400).json({ error: 'permanentIdentityNumber and dateOfBirth are required.' });
    }
    const { rows } = await db.query(
      `SELECT citizen_id, permanent_identity_number, first_name, middle_name, last_name,
              date_of_birth, sex, citizenship_status, identity_verification_status, is_deceased
       FROM citizens
       WHERE permanent_identity_number = $1 AND date_of_birth = $2`,
      [permanentIdentityNumber, dateOfBirth]
    );
    if (rows.length === 0) {
      return res.status(404).json({ verified: false, error: 'No matching identity record was found.' });
    }
    const c = rows[0];
    if (c.is_deceased) {
      return res.status(409).json({ verified: false, error: 'This identity record is recorded as deceased.' });
    }
    return res.json({
      verified: true,
      citizen: {
        citizenId: c.citizen_id,
        permanentIdentityNumber: c.permanent_identity_number,
        firstName: c.first_name,
        middleName: c.middle_name,
        lastName: c.last_name,
        dateOfBirth: c.date_of_birth,
        sex: c.sex,
        citizenshipStatus: c.citizenship_status,
        identityVerificationStatus: c.identity_verification_status,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ============================================================================================
// IDENTITY VERIFICATION REQUESTS
//
// The front door for a provisional account (registered with no matching Home Affairs record)
// to become a verified citizen. The citizen states what they know about their own identity;
// a Home Affairs officer reviews it against the citizens register and either links the account
// to the matching record (has_existing_id) or enrols them as a brand new identity, generating
// a permanent identity number exactly as birth registration approval does.
// ============================================================================================

/** POST /api/identity/requests — provisional citizen submits their claim for review. */
async function submitIdentityRequest(req, res, next) {
  try {
    if (req.user.roleKey !== 'citizen' || !req.user.isProvisional) {
      return res.status(403).json({ error: 'Only a provisional account needs identity verification.' });
    }
    const { rows: pending } = await db.query(
      `SELECT 1 FROM identity_verification_requests WHERE user_id = $1 AND status = 'Pending'`,
      [req.user.userId]
    );
    if (pending.length > 0) return res.status(409).json({ error: 'You already have an identity verification request awaiting review.' });

    const {
      hasExistingId, claimedPermanentIdentityNumber,
      firstName, middleName, lastName, dateOfBirth, placeOfBirth, sex,
    } = req.body;
    if (!firstName || !lastName || !dateOfBirth || !sex) {
      return res.status(400).json({ error: 'firstName, lastName, dateOfBirth and sex are required.' });
    }
    if (hasExistingId && !claimedPermanentIdentityNumber) {
      return res.status(400).json({ error: 'claimedPermanentIdentityNumber is required when you say you already have a permanent identity number.' });
    }

    const referenceNumber = generateReference('IDV');
    const { rows } = await db.query(
      `INSERT INTO identity_verification_requests
         (user_id, reference_number, has_existing_id, claimed_permanent_identity_number,
          first_name, middle_name, last_name, date_of_birth, place_of_birth, sex)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING request_id, reference_number, status`,
      [req.user.userId, referenceNumber, !!hasExistingId, hasExistingId ? claimedPermanentIdentityNumber : null,
       firstName, middleName || null, lastName, dateOfBirth, placeOfBirth || null, sex]
    );
    await createNotification({
      userId: req.user.userId, title: 'Identity verification submitted',
      message: `Your request ${referenceNumber} has been sent to a Home Affairs officer for review.`,
      type: 'Application Submitted',
    });
    res.status(201).json({ request: rows[0] });
  } catch (err) { next(err); }
}

/**
 * GET /api/identity/requests — citizen: own requests. Officer: the review queue, with a
 * candidate match already joined in for every claimed identity number so the officer can
 * compare "what the citizen typed" against "what Home Affairs already has on file" at a glance.
 */
async function listIdentityRequests(req, res, next) {
  try {
    if (['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey)) {
      const { status } = req.query;
      const { rows } = await db.query(
        `SELECT r.*, u.email AS applicant_email, u.phone AS applicant_phone,
                c.citizen_id AS candidate_citizen_id, c.first_name AS candidate_first_name,
                c.middle_name AS candidate_middle_name, c.last_name AS candidate_last_name,
                c.date_of_birth AS candidate_date_of_birth, c.sex AS candidate_sex,
                c.is_deceased AS candidate_is_deceased,
                -- The ID number alone matching a citizen row is NOT proof the claim is genuine —
                -- someone could type a real ID number that belongs to someone else. These two
                -- flags let the officer see, at a glance, whether what was TYPED actually agrees
                -- with what is ON FILE for that number, rather than trusting the lookup alone.
                (c.citizen_id IS NOT NULL AND c.date_of_birth = r.date_of_birth) AS candidate_dob_matches,
                (c.citizen_id IS NOT NULL
                  AND lower(trim(c.first_name)) = lower(trim(r.first_name))
                  AND lower(trim(c.last_name)) = lower(trim(r.last_name))) AS candidate_name_matches
         FROM identity_verification_requests r
         JOIN users u ON u.user_id = r.user_id
         LEFT JOIN citizens c ON c.permanent_identity_number = r.claimed_permanent_identity_number
         WHERE $1::text IS NULL OR r.status = $1
         ORDER BY r.submitted_at DESC`,
        [status || null]
      );
      return res.json({ requests: rows });
    }
    const { rows } = await db.query(
      `SELECT * FROM identity_verification_requests WHERE user_id = $1 ORDER BY submitted_at DESC`,
      [req.user.userId]
    );
    res.json({ requests: rows });
  } catch (err) { next(err); }
}

/** POST /api/identity/requests/:id/verify — officer only. */
async function verifyIdentityRequest(req, res, next) {
  try {
    if (!['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey)) {
      return res.status(403).json({ error: 'Officer only.' });
    }
    const { treatAsNewEnrolment } = req.body;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM identity_verification_requests WHERE request_id = $1 FOR UPDATE', [req.params.id]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Request not found.' }); }
      const reqRow = rows[0];
      if (reqRow.status !== 'Pending') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `This request has already been ${reqRow.status.toLowerCase()}.` });
      }

      let citizenId;
      let mismatchAtVerification = null; // recorded in the audit trail whenever the officer overrode a discrepancy
      if (reqRow.has_existing_id && !treatAsNewEnrolment) {
        const { rows: matchRows } = await client.query(
          'SELECT citizen_id, is_deceased, first_name, last_name, date_of_birth FROM citizens WHERE permanent_identity_number = $1',
          [reqRow.claimed_permanent_identity_number]
        );
        if (matchRows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'No citizen record matches that identity number. Reject the request, or retry with treatAsNewEnrolment to enrol them as a new identity instead.' });
        }
        if (matchRows[0].is_deceased) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'That identity record is recorded as deceased.' });
        }
        const candidate = matchRows[0];
        citizenId = candidate.citizen_id;
        // The ID number matching is not, by itself, proof of identity — record whether the
        // name/date of birth the applicant claimed actually agreed with what's on file, so an
        // officer who verified over a discrepancy is accountable for that call in the audit log.
        const dobMatches = new Date(candidate.date_of_birth).getTime() === new Date(reqRow.date_of_birth).getTime();
        const nameMatches = candidate.first_name.trim().toLowerCase() === reqRow.first_name.trim().toLowerCase()
          && candidate.last_name.trim().toLowerCase() === reqRow.last_name.trim().toLowerCase();
        if (!dobMatches || !nameMatches) {
          mismatchAtVerification = { dobMatches, nameMatches, claimedName: `${reqRow.first_name} ${reqRow.last_name}`, onFileName: `${candidate.first_name} ${candidate.last_name}` };
        }
        // Nothing else to create — this is a real, existing identity, just newly linked to an account.
        await client.query(
          `UPDATE citizens SET identity_verification_status = 'Verified', updated_at = NOW() WHERE citizen_id = $1`,
          [citizenId]
        );
      } else {
        citizenId = await withUniquePermanentId(reqRow.date_of_birth, async (candidatePin) => {
          const { rows: newCitizenRows } = await client.query(
            `INSERT INTO citizens (permanent_identity_number, first_name, middle_name, last_name,
                date_of_birth, place_of_birth, sex, citizenship_status, identity_verification_status, is_demo_data)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'Citizen','Verified',TRUE) RETURNING citizen_id`,
            [candidatePin, reqRow.first_name, reqRow.middle_name, reqRow.last_name,
             reqRow.date_of_birth, reqRow.place_of_birth, reqRow.sex]
          );
          return newCitizenRows[0].citizen_id;
        });
      }

      await client.query(
        `UPDATE users SET citizen_id = $1, is_provisional = FALSE, updated_at = NOW() WHERE user_id = $2`,
        [citizenId, reqRow.user_id]
      );
      await client.query(
        `UPDATE identity_verification_requests
         SET status = 'Verified', matched_citizen_id = $1, handling_officer_id = $2, reviewed_at = NOW(), updated_at = NOW()
         WHERE request_id = $3`,
        [citizenId, req.user.userId, reqRow.request_id]
      );
      await client.query('COMMIT');

      await createNotification({
        userId: reqRow.user_id, title: 'Identity verified',
        message: 'Your identity has been verified by a Home Affairs officer. You now have full access to citizen services.',
        type: 'Approval',
      });
      await recordAudit({
        userId: req.user.userId, departmentId: await getDepartmentId('home_affairs'),
        action: 'IDENTITY_REQUEST_VERIFIED', targetType: 'identity_verification_request', targetId: reqRow.request_id,
        metadata: {
          citizenId,
          newEnrolment: !reqRow.has_existing_id || !!treatAsNewEnrolment,
          // Present only when the officer verified over a discrepancy between what the citizen
          // claimed and what was already on file for that identity number — makes that call
          // traceable to the officer who accepted it.
          ...(mismatchAtVerification ? { verifiedOverMismatch: mismatchAtVerification } : {}),
        },
      });
      res.json({
        requestId: reqRow.request_id,
        status: 'Verified',
        citizenId,
        mismatchAtVerification,
      });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
}

/** POST /api/identity/requests/:id/reject  body: { reason } — officer only. */
async function rejectIdentityRequest(req, res, next) {
  try {
    if (!['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey)) {
      return res.status(403).json({ error: 'Officer only.' });
    }
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'A reason is required to reject a request.' });
    const { rows } = await db.query(
      `UPDATE identity_verification_requests
       SET status = 'Rejected', rejection_reason = $1, handling_officer_id = $2, reviewed_at = NOW(), updated_at = NOW()
       WHERE request_id = $3 AND status = 'Pending' RETURNING *`,
      [reason, req.user.userId, req.params.id]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Request not found or already reviewed.' });
    await createNotification({
      userId: rows[0].user_id, title: 'Identity verification could not be completed',
      message: `Reference ${rows[0].reference_number}: ${reason}. You can submit a new request with corrected details.`,
      type: 'Rejection',
    });
    await recordAudit({ userId: req.user.userId, departmentId: await getDepartmentId('home_affairs'), action: 'IDENTITY_REQUEST_REJECTED', targetType: 'identity_verification_request', targetId: rows[0].request_id });
    res.json({ request: rows[0] });
  } catch (err) { next(err); }
}

module.exports = {
  verifyIdentity, submitIdentityRequest, listIdentityRequests, verifyIdentityRequest, rejectIdentityRequest,
};
