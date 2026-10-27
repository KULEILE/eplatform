const db = require('../config/db');
const { recordAudit } = require('../utils/audit');

/**
 * POST /api/department-finance/context  body: { departmentKey, officeId }
 * department_finance_admin only. Switches which department + branch office this administrator
 * is currently acting as — see migration 078's doc comment. "we must have all categories" was
 * settled as: every department is selectable here, not a restricted assigned subset, so this
 * deliberately does not check against any allow-list beyond "is this a real department/office".
 */
async function switchContext(req, res, next) {
  try {
    const { departmentKey, officeId } = req.body;
    if (!departmentKey || !officeId) {
      return res.status(400).json({ error: 'departmentKey and officeId are required.' });
    }
    const { rows: deptRows } = await db.query('SELECT department_id FROM departments WHERE department_key = $1', [departmentKey]);
    if (deptRows.length === 0) return res.status(400).json({ error: 'Unknown departmentKey.' });
    const departmentId = deptRows[0].department_id;

    const { rows: officeRows } = await db.query('SELECT office_id, name FROM offices WHERE office_id = $1 AND department_id = $2', [officeId, departmentId]);
    if (officeRows.length === 0) return res.status(400).json({ error: 'That branch office does not belong to the selected department.' });

    await db.query(
      'UPDATE users SET active_department_id = $1, active_office_id = $2, updated_at = NOW() WHERE user_id = $3',
      [departmentId, officeRows[0].office_id, req.user.userId]
    );
    await recordAudit({
      userId: req.user.userId, departmentId, action: 'DEPARTMENT_FINANCE_CONTEXT_SWITCHED',
      targetType: 'office', targetId: officeRows[0].office_id, metadata: { departmentKey, officeId: officeRows[0].office_id },
    });
    res.json({ activeDepartmentKey: departmentKey, activeOfficeId: officeRows[0].office_id, activeOfficeName: officeRows[0].name });
  } catch (err) { next(err); }
}

module.exports = { switchContext };
