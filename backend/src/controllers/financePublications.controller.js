/**
 * Budget documents and tender announcements published by the Finance department.
 *
 *   GET   /api/finance/publications                     any signed-in user (officers also see removed ones)
 *   POST  /api/finance/publications                     finance officer / system admin — multipart, file field 'file'
 *   PATCH /api/finance/publications/:publicationId      finance officer / system admin — body { isActive }
 *
 * The document itself is stored in file_blobs via saveBlob() (same as every other upload in this
 * system), so the frontend downloads it from "/uploads/<file_reference>".
 */
const multer = require('multer');
const db = require('../config/db');
const { saveBlob } = require('../middleware/upload');
const { recordAudit } = require('../utils/audit');
const { getDepartmentId } = require('../utils/lookup');

const OFFICER_ROLES = ['finance_officer', 'system_administrator'];
const PUBLICATION_TYPES = ['Budget Document', 'Tender Announcement'];
const ALLOWED_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const MAX_BYTES = 8 * 1024 * 1024; // 8MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES.has(file.mimetype)) return cb(new Error('Document must be a PDF, PNG or JPG file.'));
    cb(null, true);
  },
}).single('file');

/** Wraps multer so a bad/oversized file comes back as a clear 400, not a generic 500. */
function uploadPublicationFile(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Document is too large (maximum 8MB).' : err.message;
    res.status(400).json({ error: message });
  });
}

async function listPublications(req, res, next) {
  try {
    const isOfficer = OFFICER_ROLES.includes(req.user.roleKey);
    const { rows } = await db.query(
      `SELECT publication_id, publication_type, title, description, fiscal_year, tender_deadline,
              file_reference, is_active, created_at
       FROM finance_publications
       WHERE $1::boolean OR is_active = TRUE
       ORDER BY created_at DESC`,
      [isOfficer]
    );
    res.json({ publications: rows });
  } catch (err) { next(err); }
}

async function createPublication(req, res, next) {
  try {
    if (!OFFICER_ROLES.includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { publicationType, title, description, fiscalYear, tenderDeadline } = req.body;
    if (!PUBLICATION_TYPES.includes(publicationType)) {
      return res.status(400).json({ error: `publicationType must be one of: ${PUBLICATION_TYPES.join(', ')}` });
    }
    if (!title || !title.trim()) return res.status(400).json({ error: 'A title is required.' });
    if (publicationType === 'Budget Document' && (!fiscalYear || !fiscalYear.trim())) {
      return res.status(400).json({ error: 'A fiscal year is required for a budget document (e.g. 2026/27).' });
    }
    if (publicationType === 'Tender Announcement' && (!tenderDeadline || Number.isNaN(Date.parse(tenderDeadline)))) {
      return res.status(400).json({ error: 'A valid submission deadline is required for a tender announcement.' });
    }
    if (!req.file) return res.status(400).json({ error: 'A document file is required (field name "file").' });

    const fileReference = await saveBlob('publications', req.file);
    const { rows } = await db.query(
      `INSERT INTO finance_publications
         (publication_type, title, description, fiscal_year, tender_deadline, file_reference, published_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        publicationType, title.trim(), description?.trim() || null,
        publicationType === 'Budget Document' ? fiscalYear.trim() : null,
        publicationType === 'Tender Announcement' ? tenderDeadline : null,
        fileReference, req.user.userId,
      ]
    );
    await recordAudit({
      userId: req.user.userId, departmentId: await getDepartmentId('finance'), action: 'FINANCE_PUBLICATION_CREATED',
      targetType: 'finance_publications', targetId: rows[0].publication_id, reason: publicationType,
    });
    res.status(201).json({ publication: rows[0] });
  } catch (err) { next(err); }
}

async function setPublicationActive(req, res, next) {
  try {
    if (!OFFICER_ROLES.includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    if (typeof req.body.isActive !== 'boolean') return res.status(400).json({ error: 'isActive must be true or false.' });
    const { rows } = await db.query(
      'UPDATE finance_publications SET is_active = $1, updated_at = NOW() WHERE publication_id = $2 RETURNING *',
      [req.body.isActive, req.params.publicationId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Publication not found.' });
    await recordAudit({
      userId: req.user.userId, departmentId: await getDepartmentId('finance'),
      action: req.body.isActive ? 'FINANCE_PUBLICATION_RESTORED' : 'FINANCE_PUBLICATION_REMOVED',
      targetType: 'finance_publications', targetId: rows[0].publication_id,
    });
    res.json({ publication: rows[0] });
  } catch (err) { next(err); }
}

module.exports = { uploadPublicationFile, listPublications, createPublication, setPublicationActive };
