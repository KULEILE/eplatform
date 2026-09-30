const path = require('path');
const db = require('../config/db');
const { DOCUMENTS_DIR } = require('../middleware/upload');

/** GET /api/applications — citizen: own, across every department. Employee: their department's
 *  queue. Admin: everything. This is the single "My Applications" list the requirements call for. */
async function list(req, res, next) {
  try {
    const { status, department } = req.query;
    if (req.user.roleKey === 'citizen') {
      if (!req.user.citizenId) return res.json({ applications: [] });
      const { rows } = await db.query(
        `SELECT a.*, d.name AS department_name FROM applications a JOIN departments d ON d.department_id = a.department_id
         WHERE a.citizen_id = $1 AND ($2::text IS NULL OR a.status = $2) ORDER BY a.submitted_at DESC`,
        [req.user.citizenId, status || null]
      );
      return res.json({ applications: rows });
    }
    if (req.user.roleKey === 'system_administrator') {
      const { rows } = await db.query(
        `SELECT a.*, d.name AS department_name, c.first_name, c.last_name FROM applications a
         JOIN departments d ON d.department_id = a.department_id JOIN citizens c ON c.citizen_id = a.citizen_id
         WHERE ($1::text IS NULL OR a.status = $1) AND ($2::text IS NULL OR d.department_key = $2)
         ORDER BY a.submitted_at DESC LIMIT 500`,
        [status || null, department || null]
      );
      return res.json({ applications: rows });
    }
    // Employee: restricted to their own department's applications
    const { rows } = await db.query(
      `SELECT a.*, c.first_name, c.last_name, c.permanent_identity_number FROM applications a
       JOIN citizens c ON c.citizen_id = a.citizen_id JOIN departments d ON d.department_id = a.department_id
       WHERE d.department_key = $1 AND ($2::text IS NULL OR a.status = $2) ORDER BY a.submitted_at DESC`,
      [req.user.departmentKey, status || null]
    );
    res.json({ applications: rows });
  } catch (err) { next(err); }
}

/** GET /api/applications/:id — includes the full status timeline and any uploaded documents. */
async function getOne(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT a.*, d.name AS department_name, d.department_key FROM applications a JOIN departments d ON d.department_id = a.department_id WHERE a.application_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Application not found.' });
    const application = rows[0];
    const isOwner = req.user.citizenId && req.user.citizenId === application.citizen_id;
    const isDeptOfficer = req.user.departmentKey === application.department_key;
    const isAdmin = req.user.roleKey === 'system_administrator';
    if (!isOwner && !isDeptOfficer && !isAdmin) return res.status(403).json({ error: 'You do not have access to this application.' });

    const { rows: history } = await db.query(
      'SELECT * FROM application_status_history WHERE application_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    const { rows: documents } = await db.query(
      'SELECT document_id, document_type, original_filename, verification_status, uploaded_at, verified_at FROM application_documents WHERE application_id = $1 ORDER BY uploaded_at ASC',
      [req.params.id]
    );
    res.json({ application, history, documents });
  } catch (err) { next(err); }
}

/** POST /api/applications/:id/documents — multipart upload, field name 'file'. */
async function uploadDocument(req, res, next) {
  try {
    const { rows } = await db.query('SELECT * FROM applications WHERE application_id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Application not found.' });
    const application = rows[0];
    if (req.user.citizenId !== application.citizen_id && req.user.roleKey !== 'system_administrator') {
      return res.status(403).json({ error: 'Only the applicant can upload supporting documents.' });
    }
    if (!req.file) return res.status(400).json({ error: 'A file is required (field name "file").' });
    const { documentType } = req.body;
    const fileReference = path.relative(path.join(DOCUMENTS_DIR, '..'), req.file.path);
    const { rows: doc } = await db.query(
      `INSERT INTO application_documents (application_id, document_type, file_reference, original_filename, mime_type, file_size_bytes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [application.application_id, documentType || 'Supporting Document', fileReference, req.file.originalname, req.file.mimetype, req.file.size]
    );
    res.status(201).json({ document: doc[0] });
  } catch (err) { next(err); }
}

/** POST /api/applications/documents/:documentId/verify — officer marks a document verified/rejected. */
async function verifyDocument(req, res, next) {
  try {
    if (req.user.roleKey === 'citizen') return res.status(403).json({ error: 'Employee only.' });
    const { approve } = req.body;
    const status = approve ? 'Verified' : 'Rejected';
    const { rows } = await db.query(
      `UPDATE application_documents SET verification_status = $1, verified_at = NOW() WHERE document_id = $2 RETURNING *`,
      [status, req.params.documentId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Document not found.' });
    res.json({ document: rows[0] });
  } catch (err) { next(err); }
}

module.exports = { list, getOne, uploadDocument, verifyDocument };
