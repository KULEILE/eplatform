const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../config/db');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
// Application-supporting documents (application_documents) aren't shown as images anywhere in
// the UI today — see applications.controller.js's uploadDocument — so they're left on local disk
// for now rather than moved into file_blobs below. Nothing else still writes to local disk.
const DOCUMENTS_DIR = path.join(UPLOAD_DIR, 'documents');
// Citizen-supplied ID/passport photos. Served the same way logos are — statically, under a
// random unguessable filename (see app.js's UPLOAD_DIR static mount) — rather than through an
// access-controlled endpoint. That's a deliberate simplification for this prototype, matching
// the existing logo convention: real supporting documents (application_documents) are kept out
// of static serving because they're more sensitive, but a photo used the same way a physical ID
// photo would be doesn't need that. See uploads.routes.js.
// Photos of a payment receipt/slip the citizen uploads as proof of payment, biometric enrolment
// captures, signatures, and the system logo all used to get their own disk subfolder here too
// (photos/, receipts/, biometrics/, signatures/, logo/). They're now stored in the file_blobs
// table instead (see migration 050) — only the file_key "subfolder" prefix in the generated
// reference string (e.g. "photos/1700000000000-123456789.jpg") is kept, purely so every existing
// reference already saved in the database, and every page that builds an "/uploads/..." URL from
// one, keeps working unchanged.
[UPLOAD_DIR, DOCUMENTS_DIR].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));

const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/svg+xml']);
const PHOTO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const RECEIPT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const BIOMETRIC_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const SIGNATURE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
// Budget documents and tender announcements (migration 056 / finance_publications) are real PDFs
// an officer publishes for citizens/businesses to download — unlike every other upload type
// above, which is always a photo of something. Stored in file_blobs (not local disk) for the
// same durability reason as everything else here — these need to survive a redeploy too, and
// would be a worse failure if they silently disappeared, since they're public reference
// documents rather than one citizen's own application evidence.
const PUBLICATION_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);
// Chief's letter, proof of birth, marriage certificate, acknowledgement of paternity, a
// non-citizen parent's passport (see migration 059) — always a photo or scan of a paper
// document, same as a receipt.
const APPLICATION_DOCUMENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_BIOMETRIC_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024; // 2MB — a signature-pad PNG is small
const MAX_PUBLICATION_BYTES = 10 * 1024 * 1024; // 10MB — a real budget document can be sizeable
const MAX_APPLICATION_DOCUMENT_BYTES = 8 * 1024 * 1024; // 8MB

function storageFor(dir) {
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '';
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  });
}

// Everything that used to go to storageFor(someDir) above (logo, photo, receipt, biometric,
// signature) now goes through memory storage instead: multer hands the controller the raw bytes
// in req.file.buffer, and saveBlob() below is what actually persists them (into file_blobs, not
// disk). uploadDocument is the one exception left on disk — see the comment on DOCUMENTS_DIR.
const memoryStorage = multer.memoryStorage();

/** Inserts an uploaded file's bytes into file_blobs and returns the same kind of reference
 *  string the old disk-based filenames used (e.g. "photos/1700000000000-123456789.jpg"), so
 *  every caller and every frontend page that builds an "/uploads/<reference>" URL keeps working
 *  unchanged — see migration 050 and the GET /uploads/* route in app.js. */
async function saveBlob(subdir, file, complianceNote = null) {
  const ext = path.extname(file.originalname) || '';
  const fileKey = `${subdir}/${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  await db.query(
    'INSERT INTO file_blobs (file_key, mime_type, data, compliance_note) VALUES ($1, $2, $3, $4)',
    [fileKey, file.mimetype, file.buffer, complianceNote]
  );
  return fileKey;
}

/** The counterpart read side of saveBlob's optional complianceNote (see migration 053) — used by
 *  GET /api/uploads/photo-note/:subdir/:filename so an officer reviewing an application can see
 *  whether the citizen declared a detected hat was actually a religious head covering (see
 *  frontend/src/utils/hatCheck.js and PhotoCapture.jsx). Returns null for a file with no note,
 *  or that doesn't exist — never throws on a missing key, since a missing/old photo with no note
 *  is the overwhelmingly common, entirely normal case. */
async function getBlobComplianceNote(fileKey) {
  const { rows } = await db.query('SELECT compliance_note FROM file_blobs WHERE file_key = $1', [fileKey]);
  return rows[0]?.compliance_note || null;
}

const uploadLogo = multer({
  storage: memoryStorage,
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
  storage: memoryStorage,
  limits: { fileSize: MAX_PHOTO_BYTES },
  fileFilter: (req, file, cb) => {
    if (!PHOTO_TYPES.has(file.mimetype)) {
      return cb(new Error('Photo must be PNG, JPG or WEBP.'));
    }
    cb(null, true);
  },
});

const uploadReceipt = multer({
  storage: memoryStorage,
  limits: { fileSize: MAX_RECEIPT_BYTES },
  fileFilter: (req, file, cb) => {
    if (!RECEIPT_TYPES.has(file.mimetype)) {
      return cb(new Error('Receipt photo must be PNG, JPG or WEBP.'));
    }
    cb(null, true);
  },
});

const uploadBiometric = multer({
  storage: memoryStorage,
  limits: { fileSize: MAX_BIOMETRIC_BYTES },
  fileFilter: (req, file, cb) => {
    if (!BIOMETRIC_TYPES.has(file.mimetype)) {
      return cb(new Error('Biometric capture must be PNG, JPG or WEBP.'));
    }
    cb(null, true);
  },
});

const uploadSignature = multer({
  storage: memoryStorage,
  limits: { fileSize: MAX_SIGNATURE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!SIGNATURE_TYPES.has(file.mimetype)) {
      return cb(new Error('Signature must be PNG, JPG or WEBP.'));
    }
    cb(null, true);
  },
});

const uploadPublication = multer({
  storage: memoryStorage,
  limits: { fileSize: MAX_PUBLICATION_BYTES },
  fileFilter: (req, file, cb) => {
    if (!PUBLICATION_TYPES.has(file.mimetype)) {
      return cb(new Error('Publication must be a PDF, PNG or JPG.'));
    }
    cb(null, true);
  },
});

// UNAUTHENTICATED on purpose — used by the public birth certificate application (see
// migration 059 and homeAffairs.controller.js's applyForBirthCertificatePublic), which can be
// filled in by someone who has no account yet, so there is no session to require here. The same
// saved-to-file_blobs pattern as every other upload above; nothing about this route is more
// sensitive than a receipt photo already is.
const uploadApplicationDocument = multer({
  storage: memoryStorage,
  limits: { fileSize: MAX_APPLICATION_DOCUMENT_BYTES },
  fileFilter: (req, file, cb) => {
    if (!APPLICATION_DOCUMENT_TYPES.has(file.mimetype)) {
      return cb(new Error('Document must be a PNG, JPG, WEBP or PDF.'));
    }
    cb(null, true);
  },
});

module.exports = {
  uploadLogo, uploadDocument, uploadPhoto, uploadReceipt, uploadBiometric, uploadSignature, uploadPublication,
  uploadApplicationDocument,
  saveBlob, getBlobComplianceNote, UPLOAD_DIR, DOCUMENTS_DIR,
};
