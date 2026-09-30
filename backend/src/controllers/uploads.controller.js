/**
 * Generic file-upload endpoints shared across departments. Currently just the citizen ID/passport
 * photo capture (see National ID and Passport application forms) — the photo is uploaded here,
 * before the application record exists, and the returned reference is then submitted along with
 * the rest of the application form (matches the photo_reference column already on
 * national_id_cards and passport_records).
 */

/** POST /api/uploads/photo — multipart upload, field name 'photo'. Any authenticated citizen. */
async function uploadPhoto(req, res, next) {
  try {
    if (req.user.roleKey !== 'citizen') return res.status(403).json({ error: 'Only a citizen applicant can upload a photo here.' });
    if (!req.file) return res.status(400).json({ error: 'A photo file is required (field name "photo").' });
    // Stored relative to the uploads root (e.g. "photos/171-xxxx.jpg") — servable directly under
    // the app's static /uploads mount, and this is exactly what gets saved as photo_reference.
    res.status(201).json({ photoReference: `photos/${req.file.filename}` });
  } catch (err) {
    next(err);
  }
}

module.exports = { uploadPhoto };
