/**
 * Generic file-upload endpoints shared across departments. Currently just the citizen ID/passport
 * photo capture (see National ID and Passport application forms) — the photo is uploaded here,
 * before the application record exists, and the returned reference is then submitted along with
 * the rest of the application form (matches the photo_reference column already on
 * national_id_cards and passport_records).
 *
 * The actual bytes are persisted via saveBlob() (into file_blobs — see migration 050) rather than
 * to local disk, so they survive a redeploy or idle spin-down on hosts with an ephemeral
 * filesystem (e.g. Render's free tier). The returned reference string's shape is unchanged.
 */
const { saveBlob } = require('../middleware/upload');

/** POST /api/uploads/photo — multipart upload, field name 'photo'. Any authenticated citizen. */
async function uploadPhoto(req, res, next) {
  try {
    if (req.user.roleKey !== 'citizen') return res.status(403).json({ error: 'Only a citizen applicant can upload a photo here.' });
    if (!req.file) return res.status(400).json({ error: 'A photo file is required (field name "photo").' });
    const photoReference = await saveBlob('photos', req.file);
    res.status(201).json({ photoReference });
  } catch (err) {
    next(err);
  }
}

/** POST /api/uploads/receipt — multipart upload, field name 'receipt'. Any authenticated user.
 *  Unlike uploadPhoto (citizen-only — it's always the applicant's own ID photo), a receipt is
 *  uploaded by whichever side of the counter is holding the proof of payment at that moment:
 *  the citizen themselves when applying for a passport, or the home affairs officer when
 *  recording a receipt the citizen handed over in person at the birth-certificate collection
 *  step. Same convention as uploadPhoto: stores the file and hands back a reference string that
 *  the caller then submits as part of its own request. */
async function uploadReceipt(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'A receipt file is required (field name "receipt").' });
    const receiptImageReference = await saveBlob('receipts', req.file);
    res.status(201).json({ receiptImageReference });
  } catch (err) {
    next(err);
  }
}

/** POST /api/uploads/biometric — multipart upload, field name 'biometric'. Citizen applicant only
 *  — always captured as part of the citizen's own National ID application (see
 *  applyNationalId in homeAffairs.controller.js). Same convention as uploadPhoto: this prototype
 *  has no real fingerprint scanner, so the captured image stands in for the biometric enrolment
 *  evidence a real office would take in person. */
async function uploadBiometric(req, res, next) {
  try {
    if (req.user.roleKey !== 'citizen') return res.status(403).json({ error: 'Only a citizen applicant can capture biometrics here.' });
    if (!req.file) return res.status(400).json({ error: 'A biometric capture file is required (field name "biometric").' });
    const biometricReference = await saveBlob('biometrics', req.file);
    res.status(201).json({ biometricReference });
  } catch (err) {
    next(err);
  }
}

/** POST /api/uploads/signature — multipart upload, field name 'signature'. Any authenticated
 *  user. Unlike uploadBiometric (citizen-only — it's always the applicant capturing their own
 *  biometrics), a signature is captured by an officer handing the citizen a pad at the counter
 *  at the moment of physical collection, so it's the officer's request that uploads it. */
async function uploadSignature(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'A signature file is required (field name "signature").' });
    const signatureReference = await saveBlob('signatures', req.file);
    res.status(201).json({ signatureReference });
  } catch (err) {
    next(err);
  }
}

module.exports = { uploadPhoto, uploadReceipt, uploadBiometric, uploadSignature };
