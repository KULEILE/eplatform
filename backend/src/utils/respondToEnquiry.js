/**
 * Shared "officer answers a citizen's question" action, used by:
 *   - Finance: 'Finance Complaint or Enquiry'   (POST /api/finance/:id/respond)
 *   - Pensions: 'Pension Status Enquiry'         (POST /api/pensions/:id/respond)
 *
 * body: { response }  — officer only. Saves the response, marks the record Completed, updates
 * the citizen's application index and notifies them.
 */
const db = require('../config/db');
const { syncApplicationStatus } = require('./lookup');
const { createNotification } = require('./notify');

const FINAL_STATUSES = ['Rejected', 'Completed', 'Collected', 'Paid', 'Stopped (Deceased)'];

function makeRespondHandler({ table, idColumn, officerRoleKey, serviceType }) {
  return async function respond(req, res, next) {
    try {
      if (![officerRoleKey, 'system_administrator'].includes(req.user.roleKey)) {
        return res.status(403).json({ error: 'Officer only.' });
      }
      const response = (req.body.response || '').trim();
      if (!response) return res.status(400).json({ error: 'A response is required.' });

      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(`SELECT * FROM ${table} WHERE ${idColumn} = $1 FOR UPDATE`, [req.params.id]);
        if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Record not found.' }); }
        const record = rows[0];
        if (record.service_type !== serviceType) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Only a '${serviceType}' can be responded to.` });
        }
        if (FINAL_STATUSES.includes(record.status)) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: `This record is already '${record.status}'.` });
        }
        await client.query(
          `UPDATE ${table} SET officer_response = $1, responded_at = NOW(), status = 'Completed', updated_at = NOW() WHERE ${idColumn} = $2`,
          [response, record[idColumn]]
        );
        await syncApplicationStatus(client, {
          sourceTable: table, sourceId: record[idColumn], status: 'Completed', completed: true,
          changedByUserId: req.user.userId, note: 'Officer responded.',
        });
        await client.query('COMMIT');

        const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.citizen_id])).rows[0];
        if (userRow) {
          await createNotification({
            userId: userRow.user_id,
            title: `${serviceType}: response received`,
            message: `Reference ${record.application_reference}: ${response}`,
            type: 'Status Change',
          });
        }
        res.json({ recordId: record[idColumn], status: 'Completed', officerResponse: response });
      } catch (err) {
        await client.query('ROLLBACK'); throw err;
      } finally {
        client.release();
      }
    } catch (err) { next(err); }
  };
}

module.exports = { makeRespondHandler };
