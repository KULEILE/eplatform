const db = require('../config/db');
const { getDepartmentId } = require('../utils/lookup');
const { recordAudit } = require('../utils/audit');

/**
 * Generic error-correction mechanism (FR12): a citizen flags a wrong field in any department's
 * verified record, and that department's own officer reviews and decides it. The `corrections`
 * table (migration 020) was designed to be generic from the start — its own comment says so
 * ("a citizen can report an error in Home Affairs identity data OR request a beneficiary
 * correction in Pensions, etc.") — but the original code only ever worked for Home Affairs. This
 * generalizes it so any department that needs it (Finance's government employment status, for
 * one) can reuse it instead of building its own parallel dispute mechanism.
 *
 * CORRECTABLE_FIELDS whitelists exactly which `citizens` columns a correction is allowed to
 * auto-apply on approval, and which department is authorised to decide a correction naming that
 * field — so an officer can only ever correct the facts their own department owns.
 */
const CORRECTABLE_FIELDS = {
  first_name: 'home_affairs',
  last_name: 'home_affairs',
  place_of_birth: 'home_affairs',
  government_employment_status: 'finance',
  employee_category: 'finance',
};

// Officer role keys in this app all follow `${departmentKey}_officer` — e.g. 'finance_officer',
// 'pensions_officer', 'home_affairs_officer' — so the department an officer is authorised for
// can be derived from their own role rather than needing a separate lookup table.
function officerDepartmentKey(roleKey) {
  return roleKey.replace(/_officer$/, '');
}

/** POST /api/corrections  body: { departmentKey, fieldName, currentValue, requestedValue, reason } */
async function submitCorrection(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to submit a correction request.' });
    const { departmentKey, fieldName, currentValue, requestedValue, reason } = req.body;
    if (!departmentKey || !fieldName || !requestedValue || !reason) {
      return res.status(400).json({ error: 'departmentKey, fieldName, requestedValue and reason are required.' });
    }
    if (CORRECTABLE_FIELDS[fieldName] !== departmentKey) {
      return res.status(400).json({ error: `'${fieldName}' is not a correctable field for the '${departmentKey}' department.` });
    }
    const departmentId = await getDepartmentId(departmentKey);
    const { rows } = await db.query(
      `INSERT INTO corrections (citizen_id, requested_by_user_id, department_id, field_name, current_value, requested_value, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.citizenId, req.user.userId, departmentId, fieldName, currentValue || null, requestedValue, reason]
    );
    res.status(201).json({ correction: rows[0] });
  } catch (err) {
    next(err);
  }
}

/** GET /api/corrections — officer queue (own department only, system_administrator sees all), or citizen's own */
async function listCorrections(req, res, next) {
  try {
    if (req.user.roleKey === 'system_administrator' || req.user.roleKey.endsWith('_officer')) {
      const deptKey = req.user.roleKey === 'system_administrator' ? null : officerDepartmentKey(req.user.roleKey);
      const { rows } = await db.query(
        `SELECT co.*, c.first_name, c.last_name FROM corrections co JOIN citizens c ON c.citizen_id = co.citizen_id
         JOIN departments d ON d.department_id = co.department_id
         WHERE $1::text IS NULL OR d.department_key = $1 ORDER BY co.created_at DESC`,
        [deptKey]
      );
      return res.json({ corrections: rows });
    }
    if (!req.user.citizenId) return res.json({ corrections: [] });
    const { rows } = await db.query('SELECT * FROM corrections WHERE citizen_id = $1 ORDER BY created_at DESC', [req.user.citizenId]);
    res.json({ corrections: rows });
  } catch (err) {
    next(err);
  }
}

/** POST /api/corrections/:id/decide  body: { approve: boolean } */
async function decideCorrection(req, res, next) {
  try {
    if (req.user.roleKey !== 'system_administrator' && !req.user.roleKey.endsWith('_officer')) {
      return res.status(403).json({ error: 'Officer only.' });
    }
    const { rows: existing } = await db.query(
      `SELECT co.*, d.department_key FROM corrections co JOIN departments d ON d.department_id = co.department_id WHERE co.correction_id = $1`,
      [req.params.id]
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Correction request not found.' });
    if (req.user.roleKey !== 'system_administrator' && officerDepartmentKey(req.user.roleKey) !== existing[0].department_key) {
      return res.status(403).json({ error: 'You are not authorised to decide a correction for this department.' });
    }
    const { approve } = req.body;
    const status = approve ? 'Approved' : 'Rejected';
    const { rows } = await db.query(
      `UPDATE corrections SET status = $1, reviewed_by_user_id = $2, reviewed_at = NOW(), updated_at = NOW() WHERE correction_id = $3 RETURNING *`,
      [status, req.user.userId, req.params.id]
    );
    if (approve) {
      const c = rows[0];
      if (CORRECTABLE_FIELDS[c.field_name]) {
        await db.query(`UPDATE citizens SET ${c.field_name} = $1, updated_at = NOW() WHERE citizen_id = $2`, [c.requested_value, c.citizen_id]);
      }
    }
    await recordAudit({ userId: req.user.userId, departmentId: existing[0].department_id, action: `CORRECTION_${status.toUpperCase()}`, targetType: 'correction', targetId: Number(req.params.id) });
    res.json({ correction: rows[0] });
  } catch (err) {
    next(err);
  }
}

module.exports = { submitCorrection, listCorrections, decideCorrection };
