const db = require('../config/db');

const deptCache = new Map();

async function getDepartmentId(departmentKey) {
  if (deptCache.has(departmentKey)) return deptCache.get(departmentKey);
  const { rows } = await db.query('SELECT department_id FROM departments WHERE department_key = $1', [departmentKey]);
  if (rows.length === 0) throw new Error(`Unknown department_key: ${departmentKey}`);
  deptCache.set(departmentKey, rows[0].department_id);
  return rows[0].department_id;
}

async function indexApplication(client, { citizenId, departmentKey, serviceType, referenceNumber, sourceTable, sourceId, status }) {
  const departmentId = await getDepartmentId(departmentKey);
  const { rows } = await client.query(
    `INSERT INTO applications (citizen_id, department_id, service_type, reference_number, source_table, source_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING application_id`,
    [citizenId, departmentId, serviceType, referenceNumber, sourceTable, sourceId, status]
  );
  const applicationId = rows[0].application_id;
  await client.query(
    `INSERT INTO application_status_history (application_id, status, note) VALUES ($1,$2,'Application received.')`,
    [applicationId, status]
  );
  return applicationId;
}

/** Updates the applications index row for a department-specific record AND appends a status
 *  timeline entry, so "what happened / what's happening / what's next" always has data. */
async function syncApplicationStatus(client, { sourceTable, sourceId, status, completed = false, changedByUserId = null, note = null }) {
  const { rows } = await client.query(
    `UPDATE applications SET status = $1, updated_at = NOW(), completed_at = CASE WHEN $2 THEN NOW() ELSE completed_at END
     WHERE source_table = $3 AND source_id = $4 RETURNING application_id`,
    [status, completed, sourceTable, sourceId]
  );
  if (rows[0]) {
    await client.query(
      `INSERT INTO application_status_history (application_id, status, changed_by_user_id, note) VALUES ($1,$2,$3,$4)`,
      [rows[0].application_id, status, changedByUserId, note]
    );
  }
}

module.exports = { getDepartmentId, indexApplication, syncApplicationStatus };
