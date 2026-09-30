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
[UPLOAD_DIR, LOGO_DIR, DOCUMENTS_DIR, PHOTOS_DIR].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));

const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/svg+xml']);
const PHOTO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB

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

module.exports = { uploadLogo, uploadDocument, uploadPhoto, UPLOAD_DIR, LOGO_DIR, DOCUMENTS_DIR, PHOTOS_DIR };
