// Citizen-level hand-biometric status (migration 052). Enrolment itself now only ever happens
// officer-side (National ID, in person) or server-side on approval (Naturalization) — see the
// removal note below — so this file is read-only: it just reports what citizen_biometrics holds.
const db = require('../config/db');

// ============================================================================================
// POST /api/biometrics/enroll — REMOVED (Batch 29). "the biomatrix must be captured once during
// id application so everywhere they are need they used reuse that one ... remember the rule is
// that there is no self biomatric captured."
//
// This endpoint used to let a citizen enrol their own hand-geometry template, self-keyed to
// req.user.citizenId, called automatically by components/BiometricCapture.jsx wherever a form
// passed it `enroll: true` — a standalone "complete your biometric enrolment" section on the
// citizen's own profile (pages/Profile.jsx, now just a status display), and, before this same
// batch, the Driving Licence and Public Driving Permit application forms (both now always reuse
// the citizen's existing National ID capture server-side instead — see
// drivingLicence.controller.js's resolveIdentityCapture and traffic.controller.js's beforeApply).
//
// Every remaining caller of BiometricCapture.jsx now passes `enroll: false` (Naturalization —
// the applicant has no citizen_id yet, so there is nothing to self-enrol into in the first place;
// an officer enrols that template server-side on approval), so nothing in this system legitimately
// calls this endpoint any more. It is removed outright, not just unlinked from the UI, so a
// citizen can't resurrect self-enrolment with a raw API call either. The one place hand biometrics
// are actually captured is National ID enrolment, in person, at a police station an officer
// administers (see homeAffairs.controller.js's captureNationalIdBiometrics and
// pages/police/NationalIdBiometricCapture.jsx) — reused by every service after that, forever.
//
// getBiometricStatus below is untouched: a citizen can still see WHETHER they're enrolled, just
// never enrol themselves.
// ============================================================================================

/** GET /api/biometrics/status — the logged-in citizen's own enrolment status (pages/Profile.jsx). */
async function getBiometricStatus(req, res, next) {
  try {
    if (!req.user.citizenId) return res.json({ enrolled: false, leftHand: false, rightHand: false });
    const { rows } = await db.query(
      `SELECT left_hand_captured_at, right_hand_captured_at, enrollment_source
       FROM citizen_biometrics WHERE citizen_id = $1`,
      [req.user.citizenId]
    );
    if (rows.length === 0) return res.json({ enrolled: false, leftHand: false, rightHand: false });
    const row = rows[0];
    res.json({
      enrolled: !!(row.left_hand_captured_at || row.right_hand_captured_at),
      leftHand: !!row.left_hand_captured_at,
      rightHand: !!row.right_hand_captured_at,
      enrollmentSource: row.enrollment_source,
    });
  } catch (err) { next(err); }
}

module.exports = { getBiometricStatus };
