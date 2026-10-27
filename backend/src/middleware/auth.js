const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';

/** Verifies the bearer token and attaches req.user = { userId, roleKey, departmentKey, citizenId,
 *  isForeignNational, ... }. A foreign-national account (see migration 051) has citizenId NULL
 *  exactly like a provisional account does, but isForeignNational distinguishes the two so a
 *  foreign national is routed to Citizenship by Naturalization rather than Identity Verification. */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // A password-reset token (see signResetToken below) is signed with this same secret, so it
    // is a VALID jwt — but it carries a `purpose` claim a normal login token never has, and must
    // never be accepted as a session here. Without this check, a reset token (which only ever
    // appears in the forgot-password flow) could be used to call any ordinary API route as that
    // user for its whole 15-minute life, which defeats the point of it being a separate, narrow
    // credential.
    if (payload.purpose) {
      return res.status(401).json({ error: 'Invalid or expired session.' });
    }
    // Re-check account status on every request so a suspended account is blocked immediately.
    // active_department_id/active_office_id (migration 078) are only ever set for
    // department_finance_admin — they hold whichever department+branch that administrator is
    // CURRENTLY switched to, separate from department_id/office_id which stay NULL for this
    // role (unlike branch_admin, it is never fixed to one branch).
    const { rows } = await db.query(
      `SELECT u.user_id, u.account_status, u.citizen_id, u.is_provisional, u.is_foreign_national, u.preferred_language,
              u.office_id, u.must_change_password, r.role_key, d.department_key,
              u.active_department_id, ad.department_key AS active_department_key,
              u.active_office_id, ao.name AS active_office_name
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
       LEFT JOIN departments d ON d.department_id = u.department_id
       LEFT JOIN departments ad ON ad.department_id = u.active_department_id
       LEFT JOIN offices ao ON ao.office_id = u.active_office_id
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
      isForeignNational: user.is_foreign_national,
      preferredLanguage: user.preferred_language,
      officeId: user.office_id,
      mustChangePassword: user.must_change_password,
      activeDepartmentId: user.active_department_id,
      activeDepartmentKey: user.active_department_key,
      activeOfficeId: user.active_office_id,
      activeOfficeName: user.active_office_name,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }
}

/**
 * Like requireAuth, but never blocks the request — used on the handful of routes that are
 * genuinely public (no login needed to call them) but still want to know WHO is calling, if
 * anyone happens to be logged in. Sets req.user exactly as requireAuth would when a valid
 * session token is present; otherwise leaves req.user undefined and continues anyway. Any
 * problem with the token (missing, expired, malformed, a reset token, a suspended account) is
 * treated the same as "no one is logged in" here, never as an error — this middleware's whole
 * point is to not get in the way of an anonymous caller.
 *
 * First use: POST /api/birth-certificate-applications, so an already-verified citizen who
 * happens to be logged in can be told to request a certificate reissue instead of letting them
 * silently create a second identity for themselves (see applyForBirthCertificatePublic).
 */
async function attachUserIfPresent(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.purpose) return next();
    const { rows } = await db.query(
      `SELECT u.user_id, u.account_status, u.citizen_id, r.role_key FROM users u
       JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = $1`,
      [payload.userId]
    );
    const user = rows[0];
    if (user && user.account_status === 'Active') {
      req.user = { userId: user.user_id, roleKey: user.role_key, citizenId: user.citizen_id };
    }
  } catch { /* an invalid/expired token just means "not logged in" here, not an error */ }
  next();
}

function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
}

/** A short fingerprint of a password hash — just enough to tell "still the same password" from
 *  "this password has since changed", never enough to help reconstruct the real hash. */
function passwordFingerprint(passwordHash) {
  return crypto.createHash('sha256').update(passwordHash).digest('hex').slice(0, 16);
}

/**
 * A password-reset token is deliberately NOT a login token: it carries purpose: 'password_reset'
 * and expires in 15 minutes, so even if one leaked it could never be used to call any ordinary
 * API route (requireAuth above refuses any token carrying a `purpose`), only the one reset-
 * password step it was created for. It also carries a fingerprint of the account's CURRENT
 * password hash at the moment it was issued — there is no server-side token store to revoke it
 * from otherwise, so this is what stops the same token being used twice: the first successful
 * reset changes the password hash, so the fingerprint inside the (now old) token stops matching,
 * and a replay of it is refused even though the token itself is still validly signed and
 * unexpired. See auth.controller.js's forgotPasswordVerify / forgotPasswordReset.
 */
function signResetToken(userId, currentPasswordHash) {
  return jwt.sign(
    { userId, purpose: 'password_reset', pwv: passwordFingerprint(currentPasswordHash) },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
}

/** Returns { userId, pwv } if the token is a valid, unexpired password-reset token — otherwise null.
 *  The caller (forgotPasswordReset) must still compare pwv against the account's CURRENT password
 *  hash fingerprint before trusting it — this function only checks the token's own signature and
 *  shape, not whether it has already been used. */
function verifyResetToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.purpose !== 'password_reset' || !payload.pwv) return null;
    return { userId: payload.userId, pwv: payload.pwv };
  } catch (err) {
    return null;
  }
}

module.exports = { requireAuth, attachUserIfPresent, signToken, signResetToken, verifyResetToken, passwordFingerprint, JWT_SECRET };
