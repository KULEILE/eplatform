const fs = require('fs');
const path = require('path');
const multer = require('multer');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
const LOGO_DIR = path.join(UPLOAD_DIR, 'logo');
const DOCUMENTS_DIR = path.join(UPLOAD_DIR, 'documents');
// Citizen-supplied ID/passport photos. Served the same way logos are — statically, under a
// random unguessable filename (see app.js's UPLOAD_DIR static mount) — rather than through an
// access-controlled endpoint. That's a deliberate simplification for this prototype, matching
// the existing logo convention: real supporting documents (application_documents) are kept out
// of static serving because they're more sensitive, but a photo used the same way a physical ID
// photo would be doesn't need that. See uploads.routes.js.
const PHOTOS_DIR = path.join(UPLOAD_DIR, 'photos');
// Photos of a payment receipt/slip the citizen uploads as proof of payment — same static-serving
// convention as PHOTOS_DIR (see the comment above), since a receipt photo is no more sensitive
// than an ID photo in this prototype's threat model.
const RECEIPTS_DIR = path.join(UPLOAD_DIR, 'receipts');
// Biometric enrolment capture for National ID applications. This prototype has no fingerprint
// scanner to integrate with, so — same simplification the rest of the system already makes for
// photo_reference ("simulated capture reference") — biometric enrolment is represented as an
// uploaded image (e.g. a photo of/standing in for a fingerprint scan) rather than real biometric
// data. See database/migrations/034_add_biometric_reference.sql.
const BIOMETRICS_DIR = path.join(UPLOAD_DIR, 'biometrics');
// Citizen's signature, captured on a signature pad at the collection counter (Feature 3) — an
// officer action, not a citizen upload, so uploadSignature (below) isn't restricted to the
// citizen role the way uploadPhoto/uploadBiometric are.
const SIGNATURES_DIR = path.join(UPLOAD_DIR, 'signatures');
[UPLOAD_DIR, LOGO_DIR, DOCUMENTS_DIR, PHOTOS_DIR, RECEIPTS_DIR, BIOMETRICS_DIR, SIGNATURES_DIR].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));

const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/svg+xml']);
const PHOTO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const RECEIPT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const BIOMETRIC_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const SIGNATURE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_BIOMETRIC_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024; // 2MB — a signature-pad PNG is small

function storageFor(dir) {
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '';
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  });
}

const uploadLogo = multer({
  storage: storageFor(LOGO_DIR),
  limits: { fileSize: MAX_LOGO_BYTES },
  fileFilter: (req, file, cb) => {
    if (!LOGO_TYPES.has(file.mimetype)) {
      return cb(new Error('Logo must be PNG, JPG or SVG.'));
    }
    cb(null, true);
  },
});

const uploadDocument = multer({
  storage: storageFor(DOCUMENTS_DIR),
  limits: { fileSize: MAX_DOCUMENT_BYTES },
});

const uploadPhoto = multer({
  storage: storageFor(PHOTOS_DIR),
  limits: { fileSize: MAX_PHOTO_BYTES },
  fileFilter: (req, file, cb) => {
    if (!PHOTO_TYPES.has(file.mimetype)) {
      return cb(new Error('Photo must be PNG, JPG or WEBP.'));
    }
    cb(null, true);
  },
});

const uploadReceipt = multer({
  storage: storageFor(RECEIPTS_DIR),
  limits: { fileSize: MAX_RECEIPT_BYTES },
  fileFilter: (req, file, cb) => {
    if (!RECEIPT_TYPES.has(file.mimetype)) {
      return cb(new Error('Receipt photo must be PNG, JPG or WEBP.'));
    }
    cb(null, true);
  },
});

const uploadBiometric = multer({
  storage: storageFor(BIOMETRICS_DIR),
  limits: { fileSize: MAX_BIOMETRIC_BYTES },
  fileFilter: (req, file, cb) => {
    if (!BIOMETRIC_TYPES.has(file.mimetype)) {
      return cb(new Error('Biometric capture must be PNG, JPG or WEBP.'));
    }
    cb(null, true);
  },
});

const uploadSignature = multer({
  storage: storageFor(SIGNATURES_DIR),
  limits: { fileSize: MAX_SIGNATURE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!SIGNATURE_TYPES.has(file.mimetype)) {
      return cb(new Error('Signature must be PNG, JPG or WEBP.'));
    }
    cb(null, true);
  },
});

module.exports = {
  uploadLogo, uploadDocument, uploadPhoto, uploadReceipt, uploadBiometric, uploadSignature,
  UPLOAD_DIR, LOGO_DIR, DOCUMENTS_DIR, PHOTOS_DIR, RECEIPTS_DIR, BIOMETRICS_DIR, SIGNATURES_DIR,
};