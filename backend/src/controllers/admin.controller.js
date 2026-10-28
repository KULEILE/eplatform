const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { recordAudit } = require('../utils/audit');
const { createNotification } = require('../utils/notify');
const { saveBlob } = require('../middleware/upload');

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

// "the system must automatically mark officers as government employees" — see migration 080's
// note #5. The moment an officer/admin account is linked to a citizen identity (at creation
// below, or retroactively via linkEmployeeCitizen), that citizen is marked an active government
// employee, with a default category derived from the role (police officers are the one
// uniformed/disciplined role among today's officer roles; everything else defaults to General
// Civil Servant — an officer who later needs the other category can still be changed through
// Finance's existing declareGovernmentEmployee panel). Never downgrades an already-'Retired'
// employee — retiring is a deliberate, Finance-reviewed action (finance.controller.js) and
// linking an account afterward should not silently undo it.
function employeeCategoryForRole(roleKey) {
  return roleKey === 'police_officer' ? 'Uniformed/Disciplined Services' : 'General Civil Servant';
}

async function autoActivateEmployment(queryable, citizenId, roleKey) {
  await queryable.query(
    `UPDATE citizens SET government_employment_status = 'Active',
            employee_category = COALESCE(employee_category, $1), updated_at = NOW()
     WHERE citizen_id = $2 AND government_employment_status != 'Retired'`,
    [employeeCategoryForRole(roleKey), citizenId]
  );
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

/** POST /api/admin/logo — multipart upload, field name 'logo'. Saved via saveBlob() (into
 *  file_blobs — see migration 050) rather than local disk, so it survives a redeploy or idle
 *  spin-down on hosts with an ephemeral filesystem (e.g. Render's free tier). */
async function uploadLogo(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'A logo file is required (field name "logo").' });
    const reference = await saveBlob('logo', req.file);
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

/** True for a role that manages employees for one branch office at a time rather than
 *  system-wide — branch_admin is permanently tied to that office; department_finance_admin
 *  (migration 078) is tied to whichever office it is CURRENTLY switched to. */
function currentOfficeScope(user) {
  if (user.roleKey === 'branch_admin') return { officeId: user.officeId, departmentKey: user.departmentKey, hasContext: true };
  if (user.roleKey === 'department_finance_admin') return { officeId: user.activeOfficeId, departmentKey: user.activeDepartmentKey, hasContext: !!user.activeOfficeId };
  return null;
}

/**
 * GET /api/admin/users
 * A System Administrator sees every account. A Branch Administrator only sees the employees
 * appointed to their own branch office. A Department Finance Administrator only sees the
 * employees at whichever branch office it is currently switched to (migration 078) — and sees
 * none at all until it has switched to one.
 */
async function listUsers(req, res, next) {
  try {
    const scope = currentOfficeScope(req.user);
    if (scope && !scope.hasContext) return res.json({ users: [] });
    const scopedToOffice = scope ? scope.officeId : null;
    const { rows } = await db.query(
      `SELECT u.user_id, u.username, u.email, u.phone, u.account_status, u.is_provisional, u.must_change_password,
              u.last_login_at, u.created_at, u.citizen_id, r.role_key, r.display_name AS role_name,
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
const USERNAME_RE = /^[a-z0-9_.]{3,50}$/;

async function createUser(req, res, next) {
  try {
    const { email, phone, roleKey, permanentIdentityNumber } = req.body;
    let { departmentKey, officeId } = req.body;
    const username = (req.body.username || '').trim().toLowerCase();
    if (!username || !roleKey) return res.status(400).json({ error: 'username and roleKey are required.' });
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'Username must be 3–50 characters, using only lowercase letters, numbers, "_" or ".".' });
    }

    const scope = currentOfficeScope(req.user);
    const isOfficerRole = Object.prototype.hasOwnProperty.call(OFFICER_ROLE_DEPARTMENT, roleKey);

    if (scope) {
      if (!scope.hasContext) return res.status(400).json({ error: 'Select a department and branch office first.' });
      if (!isOfficerRole) return res.status(403).json({ error: 'You may only create officer accounts.' });
      if (OFFICER_ROLE_DEPARTMENT[roleKey] !== scope.departmentKey) {
        return res.status(403).json({ error: 'You may only create officer accounts for your current department.' });
      }
      // Always the admin's own (or currently switched-to) branch — never taken from the request body.
      departmentKey = scope.departmentKey;
      officeId = scope.officeId;
    } else if (roleKey === 'branch_admin' || isOfficerRole) {
      if (!departmentKey && isOfficerRole) departmentKey = OFFICER_ROLE_DEPARTMENT[roleKey];
      if (!departmentKey || !officeId) {
        return res.status(400).json({ error: 'departmentKey and officeId are required for this role.' });
      }
      if (isOfficerRole && OFFICER_ROLE_DEPARTMENT[roleKey] !== departmentKey) {
        return res.status(400).json({ error: `${roleKey} must belong to the '${OFFICER_ROLE_DEPARTMENT[roleKey]}' department.` });
      }
    } else if (roleKey === 'department_finance_admin') {
      // Deliberately given NO department/office at creation, unlike branch_admin — it picks
      // its department+branch later, via the context switcher (migration 078).
      departmentKey = undefined;
      officeId = undefined;
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

    const { rows: existingUsername } = await db.query('SELECT 1 FROM users WHERE username = $1', [username]);
    if (existingUsername.length > 0) return res.status(409).json({ error: 'That username is already taken.' });
    if (email) {
      const { rows: existingEmail } = await db.query('SELECT 1 FROM users WHERE email = $1', [email]);
      if (existingEmail.length > 0) return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // Optional, going forward: link this new employee account to their own verified citizen
    // identity right at creation, which also marks them an active government employee (see
    // autoActivateEmployment above) — the forward-looking half of "automatically mark officers
    // as government employees"; linkEmployeeCitizen below is the retroactive half, for the
    // accounts that already exist without this link.
    let linkedCitizenId = null;
    if (permanentIdentityNumber && permanentIdentityNumber.trim()) {
      const { rows: citizenRows } = await db.query('SELECT citizen_id FROM citizens WHERE permanent_identity_number = $1', [permanentIdentityNumber.trim()]);
      if (citizenRows.length === 0) return res.status(404).json({ error: 'No citizen record matches that permanent identity number.' });
      const { rows: alreadyLinked } = await db.query(
        `SELECT 1 FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.citizen_id = $1 AND r.role_key != 'citizen'`,
        [citizenRows[0].citizen_id]
      );
      if (alreadyLinked.length > 0) return res.status(409).json({ error: 'This citizen identity is already linked to another employee account.' });
      linkedCitizenId = citizenRows[0].citizen_id;
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const { rows } = await db.query(
      `INSERT INTO users (username, email, phone, password_hash, role_id, department_id, office_id, citizen_id, account_status, must_change_password, appointed_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Active', TRUE, $9) RETURNING user_id, username, email, citizen_id`,
      [username, email || null, phone || null, passwordHash, roleRows[0].role_id, departmentId, officeIdValidated, linkedCitizenId, req.user.userId]
    );
    if (linkedCitizenId) await autoActivateEmployment(db, linkedCitizenId, roleKey);
    await recordAudit({ userId: req.user.userId, departmentId, action: 'USER_CREATED', targetType: 'user', targetId: rows[0].user_id, metadata: { roleKey, departmentKey, officeId: officeIdValidated, linkedCitizenId } });
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

/** POST /api/admin/users/:id/link-citizen  body: { permanentIdentityNumber }
 *  System Administrator only — retroactively links an EXISTING officer/admin account (created
 *  before this feature existed, or simply never linked at creation — see migration 080's note
 *  #5) to a citizen identity, which also marks that citizen an active government employee. This
 *  is the one-time fix an administrator runs once per existing employee account; going forward,
 *  createUser's optional permanentIdentityNumber above does this at creation time instead. */
async function linkEmployeeCitizen(req, res, next) {
  try {
    const { permanentIdentityNumber } = req.body;
    if (!permanentIdentityNumber || !permanentIdentityNumber.trim()) {
      return res.status(400).json({ error: 'permanentIdentityNumber is required.' });
    }
    const { rows: targetRows } = await db.query(
      `SELECT u.user_id, u.citizen_id, r.role_key FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = $1`,
      [req.params.id]
    );
    if (targetRows.length === 0) return res.status(404).json({ error: 'User not found.' });
    const target = targetRows[0];
    if (target.role_key === 'citizen') return res.status(400).json({ error: 'This action is for officer/administrator accounts, not citizen accounts.' });
    if (target.citizen_id) return res.status(409).json({ error: 'This account is already linked to a citizen identity.' });

    const { rows: citizenRows } = await db.query('SELECT citizen_id, first_name, last_name FROM citizens WHERE permanent_identity_number = $1', [permanentIdentityNumber.trim()]);
    if (citizenRows.length === 0) return res.status(404).json({ error: 'No citizen record matches that permanent identity number.' });
    const citizen = citizenRows[0];
    const { rows: alreadyLinked } = await db.query(
      `SELECT 1 FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.citizen_id = $1 AND r.role_key != 'citizen'`,
      [citizen.citizen_id]
    );
    if (alreadyLinked.length > 0) return res.status(409).json({ error: 'This citizen identity is already linked to another employee account.' });

    await db.query('UPDATE users SET citizen_id = $1, updated_at = NOW() WHERE user_id = $2', [citizen.citizen_id, target.user_id]);
    await autoActivateEmployment(db, citizen.citizen_id, target.role_key);
    await recordAudit({ userId: req.user.userId, departmentId: null, action: 'EMPLOYEE_CITIZEN_LINKED', targetType: 'user', targetId: target.user_id, metadata: { citizenId: citizen.citizen_id } });
    res.json({ userId: target.user_id, citizenId: citizen.citizen_id, citizenName: `${citizen.first_name} ${citizen.last_name}` });
  } catch (err) { next(err); }
}

/** PATCH /api/admin/users/:id  body: { accountStatus?, roleKey?, departmentKey?, officeId? } */
async function updateUser(req, res, next) {
  try {
    const { accountStatus, roleKey, departmentKey, officeId } = req.body;
    const scope = currentOfficeScope(req.user);

    if (scope) {
      // A branch admin (or a department finance admin, scoped to whichever office it is
      // currently switched to) may only suspend/reactivate employees at that one office —
      // nothing else.
      if (roleKey || departmentKey || officeId) {
        return res.status(403).json({ error: 'You may only change account status.' });
      }
      if (!scope.hasContext) return res.status(400).json({ error: 'Select a department and branch office first.' });
      const { rows: targetRows } = await db.query('SELECT office_id FROM users WHERE user_id = $1', [req.params.id]);
      if (targetRows.length === 0) return res.status(404).json({ error: 'User not found.' });
      if (targetRows[0].office_id !== scope.officeId) {
        return res.status(403).json({ error: 'You may only manage employees at your current branch.' });
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
  listUsers, createUser, updateUser, linkEmployeeCitizen, listAuditLogs, listDepartments, getStats,
};
