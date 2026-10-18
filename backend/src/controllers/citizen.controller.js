const db = require('../config/db');

/** GET /api/citizen/profile — the logged-in citizen's own verified profile (or provisional state). */
async function getProfile(req, res, next) {
  try {
    if (!req.user.citizenId) {
      // A foreign-national account (migration 051) and a provisional account both have no
      // citizen_id, but they need completely different next steps — a provisional account
      // claims an existing Mosotho identity that just hasn't been matched yet (Identity
      // Verification), while a foreign national isn't a citizen at all yet (Citizenship by
      // Naturalization) — so the shape returned here branches on isForeignNational.
      if (req.user.isForeignNational) {
        return res.json({
          foreignNational: true,
          message: 'This account is registered as a foreign national. Apply for Citizenship by Naturalization to gain access to government services.',
        });
      }
      return res.json({
        provisional: true,
        message: 'This account is not yet linked to a verified identity record.',
      });
    }
    const { rows } = await db.query(
      `SELECT citizen_id, permanent_identity_number, first_name, middle_name, last_name,
              date_of_birth, place_of_birth, sex, citizenship_status, biometric_status,
              identity_verification_status, is_deceased, created_at
       FROM citizens WHERE citizen_id = $1`,
      [req.user.citizenId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Citizen record not found.' });
    res.json({ provisional: false, citizen: rows[0] });
  } catch (err) {
    next(err);
  }
}

module.exports = { getProfile };
