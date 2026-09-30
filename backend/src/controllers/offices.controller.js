const db = require('../config/db');
const { recordAudit } = require('../utils/audit');

/** GET /api/districts — reference data, any authenticated user. */
async function listDistricts(req, res, next) {
  try {
    const { rows } = await db.query('SELECT district_id, name, code FROM districts ORDER BY name');
    res.json({ districts: rows });
  } catch (err) { next(err); }
}

/**
 * GET /api/offices?departmentKey=home_affairs&districtId=3
 * Branch offices a citizen can pick as their collection point, or that an admin can assign
 * an employee to. departmentKey is required; districtId narrows to one district.
 */
async function listOffices(req, res, next) {
  try {
    const { departmentKey, districtId } = req.query;
    if (!departmentKey) return res.status(400).json({ error: 'departmentKey is required.' });
    const params = [departmentKey];
    let where = 'd.department_key = $1';
    if (districtId) { params.push(districtId); where += ` AND o.district_id = $${params.length}`; }
    const { rows } = await db.query(
      `SELECT o.office_id, o.name, o.office_code, o.address, o.is_head_office,
              dist.district_id, dist.name AS district_name
       FROM offices o
       JOIN departments d ON d.department_id = o.department_id
       LEFT JOIN districts dist ON dist.district_id = o.district_id
       WHERE ${where}
       ORDER BY dist.name, o.is_head_office DESC, o.name`,
      params
    );
    res.json({ offices: rows });
  } catch (err) { next(err); }
}

/**
 * GET /api/offices/all — system_administrator only. Every branch office across every
 * department, with department/district names and current staff headcount, for the
 * "Manage Districts & Offices" admin screen. (listOffices above stays department-scoped,
 * for citizens picking a collection branch and admins assigning an employee.)
 */
async function listAllOffices(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT o.office_id, o.name, o.office_code, o.address, o.is_head_office, o.created_at,
              d.department_id, d.department_key, d.name AS department_name,
              dist.district_id, dist.name AS district_name,
              (SELECT COUNT(*)::int FROM users u WHERE u.office_id = o.office_id) AS staff_count
       FROM offices o
       JOIN departments d ON d.department_id = o.department_id
       LEFT JOIN districts dist ON dist.district_id = o.district_id
       ORDER BY d.name, dist.name NULLS LAST, o.is_head_office DESC, o.name`
    );
    res.json({ offices: rows });
  } catch (err) { next(err); }
}

/**
 * POST /api/offices — system_administrator only. Opens a new branch office for a department
 * in a district — this is the missing step that let an admin's dashboard show "0 Branch
 * Offices" with no way to add one.
 */
async function createOffice(req, res, next) {
  try {
    const { departmentKey, districtId, name, officeCode, address, isHeadOffice } = req.body;
    if (!departmentKey || !districtId || !name) {
      return res.status(400).json({ error: 'departmentKey, districtId and name are required.' });
    }
    const { rows: deptRows } = await db.query('SELECT department_id FROM departments WHERE department_key = $1', [departmentKey]);
    if (deptRows.length === 0) return res.status(400).json({ error: 'Unknown departmentKey.' });
    const { rows: distRows } = await db.query('SELECT district_id FROM districts WHERE district_id = $1', [districtId]);
    if (distRows.length === 0) return res.status(400).json({ error: 'Unknown districtId.' });
    if (officeCode) {
      const { rows: existingCode } = await db.query('SELECT 1 FROM offices WHERE office_code = $1', [officeCode]);
      if (existingCode.length > 0) return res.status(409).json({ error: 'That branch code is already in use.' });
    }

    const { rows } = await db.query(
      `INSERT INTO offices (department_id, district_id, name, office_code, address, is_head_office)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING office_id, name`,
      [deptRows[0].department_id, districtId, name, officeCode || null, address || null, !!isHeadOffice]
    );
    await recordAudit({
      userId: req.user.userId, departmentId: deptRows[0].department_id, action: 'OFFICE_CREATED',
      targetType: 'office', targetId: rows[0].office_id, metadata: { departmentKey, districtId, name, officeCode },
    });
    res.status(201).json({ office: rows[0] });
  } catch (err) { next(err); }
}

/** PATCH /api/offices/:id — system_administrator only. Edit an existing branch office. */
async function updateOffice(req, res, next) {
  try {
    const { name, officeCode, address, isHeadOffice, districtId } = req.body;
    const sets = [];
    const values = [];
    if (name) { sets.push(`name = $${sets.length + 1}`); values.push(name); }
    if (officeCode !== undefined) { sets.push(`office_code = $${sets.length + 1}`); values.push(officeCode || null); }
    if (address !== undefined) { sets.push(`address = $${sets.length + 1}`); values.push(address || null); }
    if (isHeadOffice !== undefined) { sets.push(`is_head_office = $${sets.length + 1}`); values.push(!!isHeadOffice); }
    if (districtId) { sets.push(`district_id = $${sets.length + 1}`); values.push(districtId); }
    if (sets.length === 0) return res.status(400).json({ error: 'No valid fields provided.' });
    values.push(req.params.id);

    const { rows } = await db.query(
      `UPDATE offices SET ${sets.join(', ')} WHERE office_id = $${values.length} RETURNING office_id, name`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Branch office not found.' });
    await recordAudit({ userId: req.user.userId, departmentId: null, action: 'OFFICE_UPDATED', targetType: 'office', targetId: rows[0].office_id, metadata: req.body });
    res.json({ office: rows[0] });
  } catch (err) { next(err); }
}

module.exports = { listDistricts, listOffices, listAllOffices, createOffice, updateOffice };
