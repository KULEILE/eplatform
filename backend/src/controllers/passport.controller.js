const db = require('../config/db');
const { generateReference } = require('../utils/referenceGenerator');
const { indexApplication, syncApplicationStatus, getDepartmentId } = require('../utils/lookup');
const { createNotification } = require('../utils/notify');
const { recordAudit } = require('../utils/audit');

/** POST /api/passport/apply — reuses the citizen's verified Home Affairs identity; only new,
 *  passport-specific information is requested from the citizen. */
async function apply(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to apply for a passport.' });
    const { passportType, preferredOfficeId, photoReference } = req.body;
    if (!preferredOfficeId) {
      return res.status(400).json({ error: 'preferredOfficeId is required — choose the branch where you will collect the passport.' });
    }
    const { rows: inProgress } = await db.query(
      `SELECT 1 FROM passport_records WHERE citizen_id = $1 AND status NOT IN ('Rejected', 'Collected')`,
      [req.user.citizenId]
    );
    if (inProgress.length > 0) return res.status(409).json({ error: 'You already have a passport application in progress.' });

    const referenceNumber = generateReference('PA');
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO passport_records (citizen_id, application_reference, passport_type, status, preferred_office_id, collection_office_id, photo_reference)
         VALUES ($1,$2,$3,'Submitted',$4,$4,$5) RETURNING passport_record_id`,
        [req.user.citizenId, referenceNumber, passportType || 'Ordinary', preferredOfficeId, photoReference || null]
      );
      await indexApplication(client, {
        citizenId: req.user.citizenId, departmentKey: 'passport', serviceType: 'Passport Application',
        referenceNumber, sourceTable: 'passport_records', sourceId: rows[0].passport_record_id, status: 'Submitted',
      });
      await client.query('COMMIT');
      await createNotification({ userId: req.user.userId, title: 'Passport application submitted', message: `Reference ${referenceNumber}. We have reused your verified Home Affairs identity information.`, type: 'Application Submitted' });
      res.status(201).json({ passportRecordId: rows[0].passport_record_id, referenceNumber, status: 'Submitted' });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    if (req.user.roleKey === 'passport_officer' || req.user.roleKey === 'system_administrator') {
      const { status } = req.query;
      const { rows } = await db.query(
        `SELECT pr.*, c.first_name, c.last_name, c.permanent_identity_number FROM passport_records pr
         JOIN citizens c ON c.citizen_id = pr.citizen_id WHERE $1::text IS NULL OR pr.status = $1 ORDER BY pr.created_at DESC`,
        [status || null]
      );
      return res.json({ passportRecords: rows });
    }
    if (!req.user.citizenId) return res.json({ passportRecords: [] });
    const { rows } = await db.query('SELECT * FROM passport_records WHERE citizen_id = $1 ORDER BY created_at DESC', [req.user.citizenId]);
    res.json({ passportRecords: rows });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT pr.*, o.name AS collection_office_name FROM passport_records pr LEFT JOIN offices o ON o.office_id = pr.collection_office_id WHERE pr.passport_record_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Passport application not found.' });
    const record = rows[0];
    const isOwner = req.user.citizenId === record.citizen_id;
    const isOfficer = ['passport_officer', 'system_administrator'].includes(req.user.roleKey);
    if (!isOwner && !isOfficer) return res.status(403).json({ error: 'You do not have access to this application.' });
    res.json({ passportRecord: record });
  } catch (err) {
    next(err);
  }
}

const TRANSITIONS = {
  'start-review': { from: 'Submitted', to: 'Under Review' },
  'verify-identity': { from: 'Under Review', to: 'Identity Verified' },
  'check-documents': { from: 'Identity Verified', to: 'Documents Checked' },
  'process': { from: 'Documents Checked', to: 'Processing' },
  'approve': { from: 'Processing', to: 'Approved' },
  'produce': { from: 'Approved', to: 'Passport Produced' },
  'ready-for-collection': { from: 'Passport Produced', to: 'Ready for Collection' },
  'collect': { from: 'Ready for Collection', to: 'Collected' },
};

async function transition(req, res, next) {
  try {
    if (!['passport_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const t = TRANSITIONS[req.params.action];
    if (!t) return res.status(400).json({ error: `Unknown action: ${req.params.action}` });
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM passport_records WHERE passport_record_id = $1 FOR UPDATE', [req.params.id]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
      const record = rows[0];
      if (record.status !== t.from) { await client.query('ROLLBACK'); return res.status(409).json({ error: `Cannot move from '${record.status}' to '${t.to}'.` }); }

      const passportNumber = t.to === 'Approved' ? 'P' + String(Math.floor(1000000 + Math.random() * 9000000)) : record.passport_number;
      const officeId = req.body.officeId || record.collection_office_id;
      await client.query(
        // $1 is cast explicitly everywhere it's used: it both SETs a varchar column and is
        // compared against text literals, and Postgres refuses to settle on one type for it
        // otherwise ("inconsistent types deduced for parameter $1") — the exact bug this same
        // pattern caused in the National ID workflow (see homeAffairs.controller.js).
        `UPDATE passport_records SET status = $1::varchar, passport_number = COALESCE($2, passport_number),
            issue_date = CASE WHEN $1::varchar = 'Approved' THEN CURRENT_DATE ELSE issue_date END,
            expiry_date = CASE WHEN $1::varchar = 'Approved' THEN CURRENT_DATE + INTERVAL '10 years' ELSE expiry_date END,
            collection_office_id = CASE WHEN $1::varchar = 'Ready for Collection' THEN $3 ELSE collection_office_id END,
            ready_for_collection_at = CASE WHEN $1::varchar = 'Ready for Collection' THEN NOW() ELSE ready_for_collection_at END,
            collected_at = CASE WHEN $1::varchar = 'Collected' THEN NOW() ELSE collected_at END,
            updated_at = NOW()
         WHERE passport_record_id = $4`,
        [t.to, passportNumber, officeId, record.passport_record_id]
      );
      await syncApplicationStatus(client, { sourceTable: 'passport_records', sourceId: record.passport_record_id, status: t.to, completed: t.to === 'Collected' });
      await client.query('COMMIT');

      const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.citizen_id])).rows[0];
      if (userRow) {
        await createNotification({
          userId: userRow.user_id, title: `Passport application: ${t.to}`,
          message: t.to === 'Ready for Collection'
            ? `Your passport (${record.application_reference}) is ready for collection. Please bring your National ID card.`
            : `Your passport application (${record.application_reference}) status is now: ${t.to}.`,
          type: t.to === 'Ready for Collection' ? 'Ready for Collection' : t.to === 'Approved' ? 'Approval' : 'Status Change',
        });
      }
      res.json({ passportRecordId: record.passport_record_id, status: t.to, passportNumber });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

/** POST /api/passport/:id/request-information body:{reason} — Additional Information Required */
async function requestInformation(req, res, next) {
  try {
    if (!['passport_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'A reason is required.' });
    const { rows } = await db.query(
      `UPDATE passport_records SET status = 'Additional Information Required', updated_at = NOW()
       WHERE passport_record_id = $1 AND status NOT IN ('Rejected','Collected') RETURNING *`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Cannot request information in the current state.' });
    await syncApplicationStatus(db, { sourceTable: 'passport_records', sourceId: Number(req.params.id), status: 'Additional Information Required' });
    const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [rows[0].citizen_id])).rows[0];
    if (userRow) await createNotification({ userId: userRow.user_id, title: 'Additional information required', message: reason, type: 'Missing Information' });
    res.json({ passportRecord: rows[0] });
  } catch (err) {
    next(err);
  }
}

/** POST /api/passport/:id/reject body:{reason} */
async function reject(req, res, next) {
  try {
    if (!['passport_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'A reason is required.' });
    const { rows } = await db.query(
      `UPDATE passport_records SET status = 'Rejected', rejection_reason = $1, updated_at = NOW()
       WHERE passport_record_id = $2 AND status NOT IN ('Rejected','Collected') RETURNING *`,
      [reason, req.params.id]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Cannot reject in the current state.' });
    await syncApplicationStatus(db, { sourceTable: 'passport_records', sourceId: Number(req.params.id), status: 'Rejected', completed: true });
    const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [rows[0].citizen_id])).rows[0];
    if (userRow) await createNotification({ userId: userRow.user_id, title: 'Passport application rejected', message: reason, type: 'Rejection' });
    await recordAudit({ userId: req.user.userId, departmentId: await getDepartmentId('passport'), action: 'PASSPORT_REJECTED', targetType: 'passport_record', targetId: Number(req.params.id), reason });
    res.json({ passportRecord: rows[0] });
  } catch (err) {
    next(err);
  }
}

module.exports = { apply, list, getOne, transition, requestInformation, reject };
