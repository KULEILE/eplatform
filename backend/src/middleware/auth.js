const jwt = require('jsonwebtoken');
const db = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';

/** Verifies the bearer token and attaches req.user = { userId, roleKey, departmentKey, citizenId }. */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Re-check account status on every request so a suspended account is blocked immediately.
    const { rows } = await db.query(
      `SELECT u.user_id, u.account_status, u.citizen_id, u.is_provisional, u.preferred_language,
              u.office_id, u.must_change_password, r.role_key, d.department_key
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
       LEFT JOIN departments d ON d.department_id = u.department_id
       WHERE u.user_id = $1`,
      [payload.userId]
    );
    const user = rows[0];
    if (!user || user.account_status !== 'Active') {
      return res.status(401).json({ error: 'Account is not active.' });
    }
    // A temporary password issued by an admin/branch admin must be changed before the account
    // can be used for anything else — everything except the auth routes themselves is blocked.
    if (user.must_change_password && req.baseUrl !== '/api/auth') {
      return res.status(403).json({ error: 'You must change your temporary password before continuing.', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    req.user = {
      userId: user.user_id,
      roleKey: user.role_key,
      departmentKey: user.department_key,
      citizenId: user.citizen_id,
      isProvisional: user.is_provisional,
      preferredLanguage: user.preferred_language,
      officeId: user.office_id,
      mustChangePassword: user.must_change_password,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }
}

function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
}

module.exports = { requireAuth, signToken, JWT_SECRET };
