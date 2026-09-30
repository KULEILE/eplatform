const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { recordAudit } = require('../utils/audit');
const { createNotification } = require('../utils/notify');

// role_key -> department_key an officer role belongs to. Derived server-side rather than
// trusted from the client, so an officer account can never be minted for the wrong department.
const OFFICER_ROLE_DEPARTMENT = {
  home_affairs_officer: 'home_affairs',
  traffic_officer: 'traffic',
  finance_officer: 'finance',
  pensions_officer: 'pensions',
  police_officer: 'police',
  passport_officer: 'passport',
};

/** A short, human-relayable temporary password — unambiguous characters only (no 0/O/1/l/I). */
function generateTempPassword() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (const byte of crypto.randomBytes(10)) out += alphabet[byte % alphabet.length];
  return out;
}

/** GET /api/public/settings — no auth required; the header/login page needs branding before login. */
async function getPublicSettings(req, res, next) {
  try {
    const { rows } = await db.query('SELECT system_name, government_logo_reference, default_language FROM system_settings ORDER BY system_settings_id LIMIT 1');
    res.json({ settings: rows[0] || { system_name: 'Integrated Government Services', government_logo_reference: null, default_language: 'en' } });
  } catch (err) { next(err); }
}

/** GET /api/admin/settings */
async function getSettings(req, res, next) {
  try {
    const { rows } = await db.query('SELECT * FROM system_settings ORDER BY system_settings_id LIMIT 1');
    res.json({ settings: rows[0] });
  } catch (err) { next(err); }
}

/** PUT /api/admin/settings  body: any subset of the configurable fields */
async function updateSettings(req, res, next) {
  try {
    const allowed = ['system_name', 'default_language', 'default_font_size', 'default_display_mode', 'default_brightness'];
    const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
    if (updates.length === 0) return res.status(400).json({ error: `No valid fields provided. Allowed: ${allowed.join(', ')}` });
    const setSql = updates.map(([k], i) => `${k} = $${i + 1}`).join(', ');
    const values = updates.map(([, v]) => v);
    const { rows } = await db.query(
      `UPDATE system_settings SET ${setSql}, updated_by_user_id = $${values.length + 1}, updated_at = NOW()
       WHERE system_settings_id = (SELECT system_settings_id FROM system_settings ORDER BY system_settings_id LIMIT 1) RETURNING *`,
      [...values, req.user.userId]
    );
    await recordAudit({ userId: req.user.userId, departmentId: null, action: 'SYSTEM_SETTINGS_UPDATED', targetType: 'system_settings', targetId: rows[0].system_settings_id, metadata: req.body });
    res.json({ settings: rows[0] });
  } catch (err) { next(err); }
}

/** POST /api/admin/logo — multipart upload, field name 'logo'. */
async function uploadLogo(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'A logo file is required (field name "logo").' });
    const reference = path.join('logo', path.basename(req.file.path));
    const { rows } = await db.query(
      `UPDATE system_settings SET government_logo_reference = $1, updated_by_user_id = $2, updated_at = NOW()
       WHERE system_settings_id = (SELECT system_settings_id FROM system_settings ORDER BY system_settings_id LIMIT 1) RETURNING *`,
      [reference, req.user.userId]
    );
    await recordAudit({ userId: req.user.userId, departmentId: null, action: 'GOVERNMENT_LOGO_UPDATED', targetType: 'system_settings', targetId: rows[0].system_settings_id });
    res.json({ settings: rows[0] });
  } catch (err) { next(err); }
}

/** DELETE /api/admin/logo — revert to fallback logo/text. */
async function removeLogo(req, res, next) {
  try {
    const { rows } = await db.query(
      `UPDATE system_settings SET government_logo_reference = NULL, updated_by_user_id = $1, updated_at = NOW()
       WHERE system_settings_id = (SELECT system_settings_id FROM system_settings ORDER BY system_settings_id LIMIT 1) RETURNING *`,
      [req.user.userId]
    );
    res.json({ settings: rows[0] });
  } catch (err) { next(err); }
}

/**
 * GET /api/admin/users
 * A System Administrator sees every account. A Branch Administrator only sees the employees
 * appointed to their own branch office — they manage their branch, not the whole system.
 */
async function listUsers(req, res, next) {
  try {
    const scopedToOffice = req.user.roleKey === 'branch_admin' ? req.user.officeId : null;
    const { rows } = await db.query(
      `SELECT u.user_id, u.email, u.phone, u.account_status, u.is_provisional, u.must_change_password,
              u.last_login_at, u.created_at, r.role_key, r.display_name AS role_name,
              d.name AS department_name, o.name AS office_name, dist.name AS district_name,
              c.first_name, c.last_name, appointer.email AS appointed_by_email
       FROM users u JOIN roles r ON r.role_id = u.role_id
       LEFT JOIN departments d ON d.department_id = u.department_id
       LEFT JOIN offices o ON o.office_id = u.office_id
       LEFT JOIN districts dist ON dist.district_id = o.district_id
       LEFT JOIN citizens c ON c.citizen_id = u.citizen_id
       LEFT JOIN users appointer ON appointer.user_id = u.appointed_by_user_id
       WHERE $1::int IS NULL OR u.office_id = $1
       ORDER BY u.created_at DESC`,
      [scopedToOffice]
    );
    res.json({ users: rows });
  } catch (err) { next(err); }
}

/**
 * POST /api/admin/users — onboard an employee account.
 *
 * System Administrator (head office): can appoint a Branch Administrator to any branch, or
 * create an officer/administrator account directly.
 * Branch Administrator: can only create an officer account for their OWN department and OWN
 * branch office — department and office are always forced to their own, never taken from the
 * request body, so a branch admin can never onboard someone into a different branch.
 *
 * Either way, the account is created with a server-generated temporary password and
 * must_change_password = TRUE — the employee is forced to set their own password at first login.
 */
async function createUser(req, res, next) {
  try {
    const { email, phone, roleKey } = req.body;
    let { departmentKey, officeId } = req.body;
    if (!email || !roleKey) return res.status(400).json({ error: 'email and roleKey are required.' });

    const isBranchAdmin = req.user.roleKey === 'branch_admin';
    const isOfficerRole = Object.prototype.hasOwnProperty.call(OFFICER_ROLE_DEPARTMENT, roleKey);

    if (isBranchAdmin) {
      if (!isOfficerRole) return res.status(403).json({ error: 'A Branch Administrator may only create officer accounts.' });
      if (OFFICER_ROLE_DEPARTMENT[roleKey] !== req.user.departmentKey) {
        return res.status(403).json({ error: 'You may only create officer accounts for your own department.' });
      }
      // Always the branch admin's own branch — never taken from the request body.
      departmentKey = req.user.departmentKey;
      officeId = req.user.officeId;
    } else if (roleKey === 'branch_admin' || isOfficerRole) {
      if (!departmentKey && isOfficerRole) departmentKey = OFFICER_ROLE_DEPARTMENT[roleKey];
      if (!departmentKey || !officeId) {
        return res.status(400).json({ error: 'departmentKey and officeId are required for this role.' });
      }
      if (isOfficerRole && OFFICER_ROLE_DEPARTMENT[roleKey] !== departmentKey) {
        return res.status(400).json({ error: `${roleKey} must belong to the '${OFFICER_ROLE_DEPARTMENT[roleKey]}' department.` });
      }
    } else if (roleKey !== 'system_administrator') {
      return res.status(400).json({ error: 'Unsupported roleKey for account creation. Use citizen self-registration for citizen accounts.' });
    }

    const { rows: roleRows } = await db.query('SELECT role_id FROM roles WHERE role_key = $1', [roleKey]);
    if (roleRows.length === 0) return res.status(400).json({ error: 'Unknown roleKey.' });

    let departmentId = null;
    if (departmentKey) {
      const { rows: deptRows } = await db.query('SELECT department_id FROM departments WHERE department_key = $1', [departmentKey]);
      if (deptRows.length === 0) return res.status(400).json({ error: 'Unknown departmentKey.' });
      departmentId = deptRows[0].department_id;
    }
    let officeIdValidated = null;
    if (officeId) {
      const { rows: officeRows } = await db.query('SELECT office_id FROM offices WHERE office_id = $1 AND department_id = $2', [officeId, departmentId]);
      if (officeRows.length === 0) return res.status(400).json({ error: 'That branch office does not belong to the selected department.' });
      officeIdValidated = officeRows[0].office_id;
    }

    const { rows: existingEmail } = await db.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (existingEmail.length > 0) return res.status(409).json({ error: 'An account with this email already exists.' });

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const { rows } = await db.query(
      `INSERT INTO users (email, phone, password_hash, role_id, department_id, office_id, account_status, must_change_password, appointed_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,'Active', TRUE, $7) RETURNING user_id, email`,
      [email, phone || null, passwordHash, roleRows[0].role_id, departmentId, officeIdValidated, req.user.userId]
    );
    await recordAudit({ userId: req.user.userId, departmentId, action: 'USER_CREATED', targetType: 'user', targetId: rows[0].user_id, metadata: { roleKey, departmentKey, officeId: officeIdValidated } });
    await createNotification({
      userId: rows[0].user_id,
      title: 'Welcome — change your temporary password',
      message: 'An administrator created this account for you with a temporary password. You must set your own password before you can use the system.',
      type: 'System',
    });
    // Returned once, here — this is the only time the plaintext temporary password exists.
    res.status(201).json({ user: rows[0], temporaryPassword: tempPassword });
  } catch (err) { next(err); }
}

/** PATCH /api/admin/users/:id  body: { accountStatus?, roleKey?, departmentKey?, officeId? } */
async function updateUser(req, res, next) {
  try {
    const { accountStatus, roleKey, departmentKey, officeId } = req.body;
    const isBranchAdmin = req.user.roleKey === 'branch_admin';

    if (isBranchAdmin) {
      // A branch admin may only suspend/reactivate their own employees — nothing else.
      if (roleKey || departmentKey || officeId) {
        return res.status(403).json({ error: 'A Branch Administrator may only change account status.' });
      }
      const { rows: targetRows } = await db.query('SELECT office_id FROM users WHERE user_id = $1', [req.params.id]);
      if (targetRows.length === 0) return res.status(404).json({ error: 'User not found.' });
      if (targetRows[0].office_id !== req.user.officeId) {
        return res.status(403).json({ error: 'You may only manage employees at your own branch.' });
      }
    }

    const sets = [];
    const values = [];
    if (accountStatus) { sets.push(`account_status = $${sets.length + 1}`); values.push(accountStatus); }
    if (roleKey) {
      const { rows } = await db.query('SELECT role_id FROM roles WHERE role_key = $1', [roleKey]);
      if (rows.length === 0) return res.status(400).json({ error: 'Unknown roleKey.' });
      sets.push(`role_id = $${sets.length + 1}`); values.push(rows[0].role_id);
    }
    if (departmentKey) {
      const { rows } = await db.query('SELECT department_id FROM departments WHERE department_key = $1', [departmentKey]);
      if (rows.length === 0) return res.status(400).json({ error: 'Unknown departmentKey.' });
      sets.push(`department_id = $${sets.length + 1}`); values.push(rows[0].department_id);
    }
    if (officeId) { sets.push(`office_id = $${sets.length + 1}`); values.push(officeId); }
    if (sets.length === 0) return res.status(400).json({ error: 'No valid fields provided.' });
    values.push(req.params.id);
    const { rows } = await db.query(`UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE user_id = $${values.length} RETURNING user_id, email, account_status`, values);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    await recordAudit({ userId: req.user.userId, departmentId: null, action: 'USER_UPDATED', targetType: 'user', targetId: rows[0].user_id, metadata: req.body });
    res.json({ user: rows[0] });
  } catch (err) { next(err); }
}

/** GET /api/audit-logs (also mounted at /api/admin/audit-logs) — admin only. */
async function listAuditLogs(req, res, next) {
  try {
    const { department, action } = req.query;
    const { rows } = await db.query(
      `SELECT al.*, u.email AS user_email, d.name AS department_name FROM audit_logs al
       LEFT JOIN users u ON u.user_id = al.user_id LEFT JOIN departments d ON d.department_id = al.department_id
       WHERE ($1::text IS NULL OR d.department_key = $1) AND ($2::text IS NULL OR al.action = $2)
       ORDER BY al.created_at DESC LIMIT 300`,
      [department || null, action || null]
    );
    res.json({ auditLogs: rows });
  } catch (err) { next(err); }
}

/** GET /api/admin/departments — used by the frontend "Choose a Government Department" screen. */
async function listDepartments(req, res, next) {
  try {
    const { rows } = await db.query('SELECT * FROM departments ORDER BY department_id');
    res.json({ departments: rows });
  } catch (err) { next(err); }
}

/**
 * GET /api/admin/stats — system_administrator only. Platform-wide counts for the admin
 * dashboard, so the System Administrator sees a genuinely distinct, data-driven view instead
 * of the same department-card grid a citizen sees.
 */
async function getStats(req, res, next) {
  try {
    const [citizens, employees, branchAdmins, offices, districts, departments, pendingApplications, totalApplications] = await Promise.all([
      db.query("SELECT COUNT(*)::int AS n FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_key = 'citizen'"),
      db.query("SELECT COUNT(*)::int AS n FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_key NOT IN ('citizen', 'system_administrator')"),
      db.query("SELECT COUNT(*)::int AS n FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_key = 'branch_admin'"),
      db.query('SELECT COUNT(*)::int AS n FROM offices'),
      db.query('SELECT COUNT(*)::int AS n FROM districts'),
      db.query('SELECT COUNT(*)::int AS n FROM departments'),
      db.query("SELECT COUNT(*)::int AS n FROM applications WHERE status NOT IN ('Completed', 'Collected', 'Rejected')"),
      db.query('SELECT COUNT(*)::int AS n FROM applications'),
    ]);
    res.json({
      totalCitizens: citizens.rows[0].n,
      totalEmployees: employees.rows[0].n,
      totalBranchAdmins: branchAdmins.rows[0].n,
      totalOffices: offices.rows[0].n,
      totalDistricts: districts.rows[0].n,
      totalDepartments: departments.rows[0].n,
      pendingApplications: pendingApplications.rows[0].n,
      totalApplications: totalApplications.rows[0].n,
    });
  } catch (err) { next(err); }
}

module.exports = {
  getPublicSettings, getSettings, updateSettings, uploadLogo, removeLogo,
  listUsers, createUser, updateUser, listAuditLogs, listDepartments, getStats,
};
