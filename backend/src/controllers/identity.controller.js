const db = require('../config/db');
const { generateReference } = require('../utils/referenceGenerator');
const { withUniquePermanentId } = require('../utils/idGenerator');
const { createNotification } = require('../utils/notify');
const { recordAudit } = require('../utils/audit');
const { getDepartmentId } = require('../utils/lookup');
const { isValidTemplate } = require('../utils/handMatch');

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
// IDENTITY VERIFICATION REQUESTS — REMOVED. This used to be the front door for a provisional
// account (registered with no matching Home Affairs record) to become a verified citizen: the
// citizen typed what they knew about themselves, uploaded hand-biometric scans, and a Home
// Affairs officer manually reviewed and linked or enrolled them.
//
// There is no longer a "provisional account" entry point to feed this (see Register.jsx and
// migration 059) — every new account now either matches an existing citizen record instantly,
// through verifyIdentity below (unchanged, automatic, no officer involved — exactly how
// "existing" registration already worked before this), or, for someone with no record at all,
// through the new public birth certificate application (homeAffairs.controller.js's
// applyForBirthCertificatePublic), which creates a real citizen record automatically and hands
// back a permanent identity number to then use with verifyIdentity.
//
// The identity_verification_requests table and any request already sitting in it are left
// completely untouched — nothing is deleted, only this manual review feature is removed.
// ============================================================================================

module.exports = { verifyIdentity };
