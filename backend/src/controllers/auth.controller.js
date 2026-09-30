const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { signToken } = require('../middleware/auth');
const { createNotification } = require('../utils/notify');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function safeUser(row) {
  return {
    userId: row.user_id,
    email: row.email,
    phone: row.phone,
    roleKey: row.role_key,
    departmentKey: row.department_key,
    citizenId: row.citizen_id,
    isProvisional: row.is_provisional,
    preferredLanguage: row.preferred_language,
    officeId: row.office_id,
    officeName: row.office_name,
    mustChangePassword: row.must_change_password,
  };
}

async function fetchUserWithRole(userId) {
  const { rows } = await db.query(
    `SELECT u.*, r.role_key, d.department_key, o.name AS office_name
     FROM users u
     JOIN roles r ON r.role_id = u.role_id
     LEFT JOIN departments d ON d.department_id = u.department_id
     LEFT JOIN offices o ON o.office_id = u.office_id
     WHERE u.user_id = $1`,
    [userId]
  );
  return rows[0];
}

/**
 * POST /api/auth/register
 * body: { mode: 'existing' | 'provisional', email, phone, password,
 *         permanentIdentityNumber?, dateOfBirth? }  (last two required when mode = 'existing')
 *
 * 'existing'    -> re-verifies identity server-side, links the new portal account to the
 *                  existing citizen record. Never creates a second citizen record, and refuses
 *                  if that citizen already has a linked account.
 * 'provisional' -> creates an account with no citizen_id. NOT a verified identity — only lets
 *                  the holder begin a Home Affairs identity process and track it, per the
 *                  assignment's registration flow.
 */
async function register(req, res, next) {
  try {
    const { mode, email, phone, password, permanentIdentityNumber, dateOfBirth } = req.body;
    if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required.' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const { rows: existingEmail } = await db.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (existingEmail.length > 0) return res.status(409).json({ error: 'An account with this email already exists.' });

    const { rows: citizenRoleRows } = await db.query(`SELECT role_id FROM roles WHERE role_key = 'citizen'`);
    const citizenRoleId = citizenRoleRows[0].role_id;
    const passwordHash = await bcrypt.hash(password, 10);

    let citizenId = null;
    let isProvisional = false;

    if (mode === 'existing') {
      if (!permanentIdentityNumber || !dateOfBirth) {
        return res.status(400).json({ error: 'permanentIdentityNumber and dateOfBirth are required for an existing identity.' });
      }
      const { rows: citizenRows } = await db.query(
        `SELECT citizen_id FROM citizens WHERE permanent_identity_number = $1 AND date_of_birth = $2 AND is_deceased = FALSE`,
        [permanentIdentityNumber, dateOfBirth]
      );
      if (citizenRows.length === 0) {
        return res.status(404).json({ error: 'No matching identity record was found. Check your permanent identity number and date of birth.' });
      }
      citizenId = citizenRows[0].citizen_id;
      const { rows: alreadyLinked } = await db.query('SELECT 1 FROM users WHERE citizen_id = $1', [citizenId]);
      if (alreadyLinked.length > 0) {
        return res.status(409).json({ error: 'A portal account is already linked to this identity record. Please log in instead.' });
      }
    } else if (mode === 'provisional') {
      isProvisional = true;
    } else {
      return res.status(400).json({ error: "mode must be 'existing' or 'provisional'." });
    }

    const { rows } = await db.query(
      `INSERT INTO users (citizen_id, email, phone, password_hash, role_id, is_provisional)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING user_id`,
      [citizenId, email, phone || null, passwordHash, citizenRoleId, isProvisional]
    );
    const userId = rows[0].user_id;

    await createNotification({
      userId,
      title: isProvisional ? 'Welcome — provisional account created' : 'Welcome — identity verified',
      message: isProvisional
        ? 'Your account has been created. A provisional account lets you begin a Home Affairs identity process and track it, but it is not yet a verified identity. Complete Home Affairs registration or verification to unlock all services.'
        : 'Your account has been linked to your verified Home Affairs identity record. You can now access all government services.',
      type: 'System',
    });

    const token = signToken(userId);
    const user = await fetchUserWithRole(userId);
    return res.status(201).json({ token, user: safeUser(user) });
  } catch (err) {
    next(err);
  }
}

/** POST /api/auth/login  body: { email, password } */
async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    const { rows } = await db.query(
      `SELECT u.*, r.role_key, d.department_key, o.name AS office_name FROM users u
       JOIN roles r ON r.role_id = u.role_id
       LEFT JOIN departments d ON d.department_id = u.department_id
       LEFT JOIN offices o ON o.office_id = u.office_id
       WHERE lower(u.email) = lower($1)`,
      [email]
    );
    const found = rows[0];
    if (!found) return res.status(401).json({ error: 'Invalid email or password.' });
    if (found.account_status !== 'Active') return res.status(403).json({ error: `Account is ${found.account_status.toLowerCase()}.` });

    const match = await bcrypt.compare(password, found.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password.' });

    await db.query('UPDATE users SET last_login_at = NOW() WHERE user_id = $1', [found.user_id]);
    const token = signToken(found.user_id);
    return res.json({ token, user: safeUser(found) });
  } catch (err) {
    next(err);
  }
}

/** POST /api/auth/logout — stateless JWT, so this is a client-side no-op kept for API completeness. */
async function logout(req, res) {
  res.json({ success: true });
}

/**
 * POST /api/auth/change-password  body: { currentPassword, newPassword }
 * Used both for a forced first-login change (a temporary password issued by an admin/branch
 * admin) and for a voluntary change from Settings — the same rule applies either way: you must
 * know the current password to set a new one.
 */
async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'currentPassword and newPassword are required.' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    if (newPassword === currentPassword) return res.status(400).json({ error: 'New password must be different from the current password.' });

    const { rows } = await db.query('SELECT password_hash FROM users WHERE user_id = $1', [req.user.userId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' });
    const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db.query(
      `UPDATE users SET password_hash = $1, must_change_password = FALSE, updated_at = NOW() WHERE user_id = $2`,
      [passwordHash, req.user.userId]
    );
    const user = await fetchUserWithRole(req.user.userId);
    res.json({ user: safeUser(user) });
  } catch (err) {
    next(err);
  }
}

/** GET /api/auth/me */
async function me(req, res, next) {
  try {
    const user = await fetchUserWithRole(req.user.userId);
    res.json({ user: safeUser(user) });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, logout, me, changePassword };
