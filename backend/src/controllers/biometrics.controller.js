// Citizen-level hand-biometric enrolment (migration 052). Storage only — the actual extraction
// happens entirely in the browser (frontend/src/utils/handGeometry.js) before this is ever
// called, and matching for a Police lookup lives in police.controller.js + utils/handMatch.js.
const db = require('../config/db');
const { isValidTemplate } = require('../utils/handMatch');

const VALID_HANDS = ['left', 'right'];

/**
 * POST /api/biometrics/enroll
 * body: { hand: 'left'|'right', template: { signature[], aspectRatio, fingerCount }, source? }
 *
 * Self-enrolment only — always keyed to req.user.citizenId, never to a citizenId supplied in the
 * body, so there is no way to enrol a template under someone else's record. This is called from
 * exactly one place in the frontend: components/BiometricCapture.jsx, automatically, right after
 * a citizen who already has a citizen_id captures a hand scan as part of a form that already
 * required one (National ID application, a Driving Licence service, ...), or via the standalone
 * "complete your biometric enrolment" option on the citizen's own profile (pages/Profile.jsx).
 *
 * The pre-citizenId flows (Naturalization, Identity Verification) do NOT call this endpoint —
 * the applicant has no citizen_id to key it on yet, so their captured templates are held on
 * their own request row instead and copied in directly, server-side, by the officer-approval
 * controller at the moment a citizen_id is actually minted/linked (see
 * naturalization.controller.js's approveNaturalization and identity.controller.js's
 * verifyIdentityRequest).
 */
async function enrollHand(req, res, next) {
  try {
    if (!req.user.citizenId) {
      return res.status(403).json({ error: 'A verified identity is required before enrolling a biometric.' });
    }
    const { hand, template, source } = req.body;
    if (!VALID_HANDS.includes(hand)) return res.status(400).json({ error: "hand must be 'left' or 'right'." });
    if (!isValidTemplate(template)) return res.status(400).json({ error: 'A valid hand-geometry template is required.' });

    // hand is checked against VALID_HANDS above before it ever reaches a column name, so this
    // interpolation only ever picks between two fixed, hardcoded identifiers — never user input.
    const column = hand === 'left' ? 'left_hand_template' : 'right_hand_template';
    const capturedAtColumn = hand === 'left' ? 'left_hand_captured_at' : 'right_hand_captured_at';
    await db.query(
      `INSERT INTO citizen_biometrics (citizen_id, ${column}, ${capturedAtColumn}, enrollment_source, updated_at)
       VALUES ($1, $2, NOW(), $3, NOW())
       ON CONFLICT (citizen_id) DO UPDATE
         SET ${column} = EXCLUDED.${column}, ${capturedAtColumn} = NOW(),
             enrollment_source = EXCLUDED.enrollment_source, updated_at = NOW()`,
      [req.user.citizenId, JSON.stringify(template), source || 'Self-Enrolment']
    );
    res.status(201).json({ enrolled: true, hand });
  } catch (err) { next(err); }
}

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

module.exports = { enrollHand, getBiometricStatus };
