/**
 * Shared factory for the three "breadth" departments whose workflow is a straightforward
 * linear status progression with no special physical-collection or audit requirements beyond
 * the standard notification-on-status-change pattern: Traffic, Finance, Pensions.
 *
 * Each still gets its own department_key, table, allowed service types and status vocabulary —
 * this factory only removes the boilerplate of apply/list/get/transition/reject, it does not
 * pretend the departments are identical.
 */
const db = require('../config/db');
const { generateReference } = require('./referenceGenerator');
const { indexApplication, syncApplicationStatus, getDepartmentId } = require('./lookup');
const { createNotification } = require('./notify');
const { recordAudit } = require('./audit');

function makeDepartmentController({
  table,           // e.g. 'traffic_records'
  idColumn,        // e.g. 'traffic_record_id'
  deptKey,         // e.g. 'traffic'
  officerRoleKey,  // e.g. 'traffic_officer'
  refPrefix,       // e.g. 'TR'
  serviceTypes,    // array of allowed service_type values
  extraInsertFields = [], // [{ column, fromBody }]
  statusFlow,      // { action: { from, to, terminal? } }
  finalStatuses = ['Rejected', 'Completed', 'Collected'],
  // Optional: async (req) => null | { status, error } — runs after the serviceType check but
  // before any row is written, so a service that needs server-side eligibility logic (e.g. an
  // age check against the citizen's own verified date of birth) can reject the request up
  // front with a clear reason, without every department having to reimplement apply().
  beforeApply,
}) {
  async function apply(req, res, next) {
    try {
      if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to use this service.' });
      const { serviceType } = req.body;
      if (!serviceTypes.includes(serviceType)) {
        return res.status(400).json({ error: `serviceType must be one of: ${serviceTypes.join(', ')}` });
      }
      if (beforeApply) {
        const problem = await beforeApply(req);
        if (problem) return res.status(problem.status || 400).json({ error: problem.error });
      }
      const referenceNumber = generateReference(refPrefix);
      const extraCols = extraInsertFields.map((f) => f.column);
      const extraVals = extraInsertFields.map((f) => req.body[f.fromBody] ?? null);
      const columns = ['citizen_id', 'application_reference', 'service_type', ...extraCols];
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(',');
      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders}) RETURNING ${idColumn}`,
          [req.user.citizenId, referenceNumber, serviceType, ...extraVals]
        );
        const recordId = rows[0][idColumn];
        await indexApplication(client, {
          citizenId: req.user.citizenId, departmentKey: deptKey, serviceType, referenceNumber,
          sourceTable: table, sourceId: recordId, status: 'Submitted',
        });
        await client.query('COMMIT');
        await createNotification({ userId: req.user.userId, title: `${serviceType} submitted`, message: `Reference ${referenceNumber}. Your verified identity has been reused for this application.`, type: 'Application Submitted' });
        res.status(201).json({ recordId, referenceNumber, status: 'Submitted' });
      } catch (err) {
        await client.query('ROLLBACK'); throw err;
      } finally {
        client.release();
      }
    } catch (err) { next(err); }
  }

  async function list(req, res, next) {
    try {
      if (req.user.roleKey === officerRoleKey || req.user.roleKey === 'system_administrator') {
        const { status } = req.query;
        const { rows } = await db.query(
          `SELECT t.*, c.first_name, c.last_name, c.permanent_identity_number FROM ${table} t
           JOIN citizens c ON c.citizen_id = t.citizen_id WHERE $1::text IS NULL OR t.status = $1 ORDER BY t.created_at DESC`,
          [status || null]
        );
        return res.json({ records: rows });
      }
      if (!req.user.citizenId) return res.json({ records: [] });
      const { rows } = await db.query(`SELECT * FROM ${table} WHERE citizen_id = $1 ORDER BY created_at DESC`, [req.user.citizenId]);
      res.json({ records: rows });
    } catch (err) { next(err); }
  }

  async function getOne(req, res, next) {
    try {
      const { rows } = await db.query(`SELECT * FROM ${table} WHERE ${idColumn} = $1`, [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: 'Record not found.' });
      const record = rows[0];
      const isOwner = req.user.citizenId === record.citizen_id;
      const isOfficer = [officerRoleKey, 'system_administrator'].includes(req.user.roleKey);
      if (!isOwner && !isOfficer) return res.status(403).json({ error: 'You do not have access to this record.' });
      res.json({ record });
    } catch (err) { next(err); }
  }

  async function transition(req, res, next) {
    try {
      if (![officerRoleKey, 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
      const t = statusFlow[req.params.action];
      if (!t) return res.status(400).json({ error: `Unknown action: ${req.params.action}` });
      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(`SELECT * FROM ${table} WHERE ${idColumn} = $1 FOR UPDATE`, [req.params.id]);
        if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
        const record = rows[0];
        if (record.status !== t.from) { await client.query('ROLLBACK'); return res.status(409).json({ error: `Cannot move from '${record.status}' to '${t.to}'.` }); }
        // t.extra(record, req) may return { setSql: 'col = $3, col2 = $4', params: [v3, v4] }
        // referencing additional placeholders starting at $3 — used e.g. to assign a licence
        // number on approval without hardcoding department-specific columns in this factory.
        const extra = t.extra ? t.extra(record, req) : null;
        const setSql = extra ? `, ${extra.setSql}` : '';
        const params = [t.to, record[idColumn], ...(extra ? extra.params : [])];
        await client.query(
          `UPDATE ${table} SET status = $1, updated_at = NOW() ${setSql} WHERE ${idColumn} = $2`,
          params
        );
        await syncApplicationStatus(client, { sourceTable: table, sourceId: record[idColumn], status: t.to, completed: finalStatuses.includes(t.to) });
        await client.query('COMMIT');
        const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.citizen_id])).rows[0];
        if (userRow) {
          await createNotification({ userId: userRow.user_id, title: `${record.service_type}: ${t.to}`, message: `Reference ${record.application_reference} is now: ${t.to}.`,
            type: t.to === 'Ready for Collection' ? 'Ready for Collection' : t.to === 'Approved' || t.to === 'Completed' ? 'Approval' : 'Status Change' });
        }
        res.json({ recordId: record[idColumn], status: t.to });
      } catch (err) {
        await client.query('ROLLBACK'); throw err;
      } finally {
        client.release();
      }
    } catch (err) { next(err); }
  }

  async function requestInformation(req, res, next) {
    try {
      if (![officerRoleKey, 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
      const { reason } = req.body;
      if (!reason) return res.status(400).json({ error: 'A reason is required.' });
      const { rows } = await db.query(
        `UPDATE ${table} SET status = 'Additional Information Required', updated_at = NOW() WHERE ${idColumn} = $1 AND status NOT IN ('Rejected','Completed','Collected') RETURNING *`,
        [req.params.id]
      );
      if (rows.length === 0) return res.status(409).json({ error: 'Cannot request information in the current state.' });
      await syncApplicationStatus(db, { sourceTable: table, sourceId: rows[0][idColumn], status: 'Additional Information Required' });
      const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [rows[0].citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Additional information required', message: reason, type: 'Missing Information' });
      res.json({ record: rows[0] });
    } catch (err) { next(err); }
  }

  async function reject(req, res, next) {
    try {
      if (![officerRoleKey, 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
      const { reason } = req.body;
      if (!reason) return res.status(400).json({ error: 'A reason is required.' });
      const { rows } = await db.query(
        `UPDATE ${table} SET status = 'Rejected', rejection_reason = $1, updated_at = NOW() WHERE ${idColumn} = $2 AND status NOT IN ('Rejected','Completed','Collected') RETURNING *`,
        [reason, req.params.id]
      );
      if (rows.length === 0) return res.status(409).json({ error: 'Cannot reject in the current state.' });
      await syncApplicationStatus(db, { sourceTable: table, sourceId: rows[0][idColumn], status: 'Rejected', completed: true });
      const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [rows[0].citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Application rejected', message: reason, type: 'Rejection' });
      await recordAudit({ userId: req.user.userId, departmentId: await getDepartmentId(deptKey), action: `${deptKey.toUpperCase()}_REJECTED`, targetType: table, targetId: rows[0][idColumn], reason });
      res.json({ record: rows[0] });
    } catch (err) { next(err); }
  }

  return { apply, list, getOne, transition, requestInformation, reject };
}

module.exports = { makeDepartmentController };
