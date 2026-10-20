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
const { saveBlob, getBlobComplianceNote } = require('../middleware/upload');
const { checkWornAccessories, classifyWornAccessoryResult } = require('../utils/roboflowWornAccessoryCheck');

// The only compliance note this system knows how to record right now — see
// roboflowWornAccessoryCheck.js and PhotoCapture.jsx's religious-head-covering exception.
// Validated against this fixed set (rather than storing whatever string the client sends) so
// this column can never become a place for arbitrary client-supplied text.
const KNOWN_COMPLIANCE_NOTES = new Set(['religious_head_covering_declared']);

/** POST /api/uploads/photo — multipart upload, field name 'photo'. Any authenticated citizen.
 *  Optional text field 'complianceNote' — set only by PhotoCapture.jsx's religious-head-covering
 *  override, never user-typed — is stored alongside the photo (see migration 053) so an officer
 *  reviewing the application can see it was self-declared.
 *
 *  Optional text field 'faceCheck' — set to the string 'true' only by PhotoCapture.jsx instances
 *  rendered with its faceCheck prop (ID/passport/licence photos — NOT plain document scans like a
 *  chief's letter, which share this same endpoint). Only when it's set does this run the real
 *  hat/cap/glasses/face-obstruction detector (see roboflowWornAccessoryCheck.js) — running it on
 *  a document scan would reject photos for having "no face", which makes no sense there.
 *
 *  This check runs server-side, after the file has already been uploaded here, rather than
 *  client-side during capture the way the old (and unreliable — see
 *  frontend/src/utils/hatCheck.js's history) on-device model did. The real tradeoff: a citizen no
 *  longer gets instant feedback while the camera is still open; they find out after this request
 *  completes and have to reopen the camera to retake. In exchange, the detection itself is
 *  actually accurate — see roboflowWornAccessoryCheck.js for how that was verified against real
 *  reported photos before being wired in here.
 *
 *  Fails OPEN, same convention as every other compliance check in this project (see
 *  frontend/src/utils/faceCheck.js): if the Roboflow call itself fails for any reason — no API
 *  key configured, the network, a timeout, Roboflow being down — the error is logged and the
 *  upload proceeds normally rather than blocking every citizen's submission on an infrastructure
 *  hiccup on a third-party service this project doesn't control. Only an actual, successful
 *  rejection verdict from Roboflow blocks the upload. */
async function uploadPhoto(req, res, next) {
  try {
    if (req.user.roleKey !== 'citizen') return res.status(403).json({ error: 'Only a citizen applicant can upload a photo here.' });
    if (!req.file) return res.status(400).json({ error: 'A photo file is required (field name "photo").' });
    const { complianceNote, faceCheck } = req.body;
    if (complianceNote && !KNOWN_COMPLIANCE_NOTES.has(complianceNote)) {
      return res.status(400).json({ error: 'Unrecognized complianceNote value.' });
    }

    if (faceCheck === 'true') {
      try {
        const result = await checkWornAccessories(req.file.buffer);
        const rejection = classifyWornAccessoryResult(result, { complianceNote });
        if (rejection) {
          return res.status(422).json({ error: rejection.message, reason: rejection.reason });
        }
      } catch (err) {
        // Fail open — see the doc comment above. Logged so a persistently misconfigured/failing
        // check (e.g. ROBOFLOW_API_KEY never set) is visible in the server logs even though it
        // never blocks a citizen.
        // eslint-disable-next-line no-console
        console.error('Roboflow worn-accessory check failed; accepting the photo anyway (fail open):', err.message);
      }
    }

    const photoReference = await saveBlob('photos', req.file, complianceNote || null);
    res.status(201).json({ photoReference });
  } catch (err) {
    next(err);
  }
}

/** GET /api/uploads/photo-note/:subdir/:filename — any authenticated user. Reads back the
 *  optional compliance note saved alongside a photo/receipt/biometric/signature reference (see
 *  uploadPhoto above and migration 053). Split into two path params rather than one, because the
 *  file_key references this system hands out everywhere else (e.g. "photos/172...-591...jpg")
 *  contain a literal "/", which an Express ":param" segment won't match on its own. Harmless to
 *  expose to anyone authenticated: it's a one-word declaration tag, not the file's contents, and
 *  every file_key is already an unguessable random string, same as the static /uploads mount. */
async function getPhotoComplianceNote(req, res, next) {
  try {
    const fileKey = `${req.params.subdir}/${req.params.filename}`;
    const complianceNote = await getBlobComplianceNote(fileKey);
    res.json({ complianceNote });
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

module.exports = { uploadPhoto, uploadReceipt, uploadBiometric, uploadSignature, getPhotoComplianceNote };
