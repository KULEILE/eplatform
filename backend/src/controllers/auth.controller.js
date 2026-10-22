const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { signToken, signResetToken, verifyResetToken, passwordFingerprint } = require('../middleware/auth');
const { createNotification } = require('../utils/notify');
const { SECURITY_QUESTION_KEYS } = require('../utils/securityQuestions');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9_.]{3,50}$/;

function normalizeUsername(username) {
  return (username || '').trim().toLowerCase();
}

/** A security answer is matched case-insensitively and ignoring surrounding spaces, so "Maseru",
 *  "maseru " and "MASERU" all count as the same answer. */
function normalizeAnswer(answer) {
  return (answer || '').trim().toLowerCase();
}

function safeUser(row) {
  return {
    userId: row.user_id,
    username: row.username,
    email: row.email,
    phone: row.phone,
    roleKey: row.role_key,
    departmentKey: row.department_key,
    citizenId: row.citizen_id,
    isProvisional: row.is_provisional,
    isForeignNational: row.is_foreign_national,
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

/** Validates { questionKey, answer } pairs for registration/change: exactly two, both keys from
 *  the fixed list, no duplicate key, and a non-trivial answer for each. Returns an error string,
 *  or null if everything is valid. */
function validateSecurityAnswers(securityAnswers) {
  if (!Array.isArray(securityAnswers) || securityAnswers.length !== 2) {
    return 'Choose exactly two security questions and answer both.';
  }
  const keys = securityAnswers.map((a) => a && a.questionKey);
  if (keys.some((k) => !SECURITY_QUESTION_KEYS.includes(k))) {
    return 'One of the chosen security questions is not recognised.';
  }
  if (keys[0] === keys[1]) {
    return 'Choose two different security questions.';
  }
  if (securityAnswers.some((a) => normalizeAnswer(a.answer).length < 2)) {
    return 'Each security answer must be at least 2 characters.';
  }
  return null;
}

/**
 * POST /api/auth/register
 * body: { mode: 'existing' | 'provisional' | 'foreign', username, password,
 *         securityAnswers: [{questionKey, answer}, {questionKey, answer}],
 *         email?, phone?, permanentIdentityNumber?, dateOfBirth? }  (last two required when mode = 'existing')
 *
 * 'existing'    -> re-verifies identity server-side, links the new portal account to the
 *                  existing citizen record. Never creates a second citizen record, and refuses
 *                  if that citizen already has a linked account.
 * 'provisional' -> creates an account with no citizen_id. NOT a verified identity — only lets
 *                  the holder begin a Home Affairs identity process and track it, per the
 *                  assignment's registration flow. Used by someone who IS (or believes they
 *                  are) a Mosotho citizen, just not yet matched/verified against the register.
 * 'foreign'     -> creates an account with no citizen_id AND is_foreign_national = TRUE, for
 *                  someone who is NOT a Lesotho citizen at all. See migration 051: this account
 *                  stays locked out of every citizen service (they all require citizenId) until
 *                  Citizenship by Naturalization approves an application and creates a citizens
 *                  row for them — see naturalization.controller.js.
 *
 * Username + password is the universal login credential for every citizen — email and phone are
 * optional extras, not needed to log in. Because they're optional, every account also sets two
 * security questions here, used only by the "forgot password" flow (there is no email to send a
 * reset link to).
 */
async function register(req, res, next) {
  try {
    const { mode, email, phone, password, permanentIdentityNumber, dateOfBirth, securityAnswers } = req.body;
    const username = normalizeUsername(req.body.username);

    if (!username || !USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'Username must be 3–50 characters, using only lowercase letters, numbers, "_" or ".".' });
    }
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'That email address does not look valid.' });
    const securityAnswersError = validateSecurityAnswers(securityAnswers);
    if (securityAnswersError) return res.status(400).json({ error: securityAnswersError });

    const { rows: existingUsername } = await db.query('SELECT 1 FROM users WHERE username = $1', [username]);
    if (existingUsername.length > 0) return res.status(409).json({ error: 'That username is already taken.' });
    if (email) {
      const { rows: existingEmail } = await db.query('SELECT 1 FROM users WHERE email = $1', [email]);
      if (existingEmail.length > 0) return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const { rows: citizenRoleRows } = await db.query(`SELECT role_id FROM roles WHERE role_key = 'citizen'`);
    const citizenRoleId = citizenRoleRows[0].role_id;
    const passwordHash = await bcrypt.hash(password, 10);

    let citizenId = null;
    let isProvisional = false;
    let isForeignNational = false;

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
    } else if (mode === 'foreign') {
      isForeignNational = true;
    } else {
      return res.status(400).json({ error: "mode must be 'existing', 'provisional' or 'foreign'." });
    }

    const client = await db.getClient();
    let userId;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO users (citizen_id, username, email, phone, password_hash, role_id, is_provisional, is_foreign_national)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING user_id`,
        [citizenId, username, email || null, phone || null, passwordHash, citizenRoleId, isProvisional, isForeignNational]
      );
      userId = rows[0].user_id;
      for (const a of securityAnswers) {
        const answerHash = await bcrypt.hash(normalizeAnswer(a.answer), 10);
        await client.query(
          `INSERT INTO user_security_answers (user_id, question_key, answer_hash) VALUES ($1,$2,$3)`,
          [userId, a.questionKey, answerHash]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await createNotification({
      userId,
      title: isForeignNational ? 'Welcome — foreign national account created' : isProvisional ? 'Welcome — provisional account created' : 'Welcome — identity verified',
      message: isForeignNational
        ? 'Your account has been created. As a foreign national, you do not yet have access to government services — apply for Citizenship by Naturalization under Home Affairs once you have lived in Lesotho for at least 5 years. All other services unlock once that application is approved.'
        : isProvisional
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

/**
 * POST /api/auth/login  body: { username, password }
 * `username` here means "whatever the citizen types to identify themselves" — it can be their
 * actual username, OR, if their account has one on file, their email address. This is so a
 * citizen who registered before email became optional (or who simply prefers typing their
 * email) can keep logging in the way they're used to, while username stays the one credential
 * every account is guaranteed to have. Matching on email is case-insensitive, same as a
 * username; matching on username is exact (usernames are already stored lowercase — see
 * normalizeUsername at registration).
 */
async function login(req, res, next) {
  try {
    const identifier = normalizeUsername(req.body.username);
    const { password } = req.body;
    if (!identifier || !password) return res.status(400).json({ error: 'Username (or email) and password are required.' });

    const { rows } = await db.query(
      `SELECT u.*, r.role_key, d.department_key, o.name AS office_name FROM users u
       JOIN roles r ON r.role_id = u.role_id
       LEFT JOIN departments d ON d.department_id = u.department_id
       LEFT JOIN offices o ON o.office_id = u.office_id
       WHERE u.username = $1 OR LOWER(u.email) = $1`,
      [identifier]
    );
    const found = rows[0];
    if (!found) return res.status(401).json({ error: 'Invalid username/email or password.' });
    if (found.account_status !== 'Active') return res.status(403).json({ error: `Account is ${found.account_status.toLowerCase()}.` });

    const match = await bcrypt.compare(password, found.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid username/email or password.' });

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

/**
 * POST /api/auth/forgot-password/start  body: { username }
 * Step 1 of password recovery. Returns which two security questions THIS account chose (by key
 * only — never the answers), so the frontend knows what to ask next. Does not say anything else
 * about the account.
 */
async function forgotPasswordStart(req, res, next) {
  try {
    const username = normalizeUsername(req.body.username);
    if (!username) return res.status(400).json({ error: 'Username is required.' });

    const { rows: userRows } = await db.query('SELECT user_id FROM users WHERE username = $1', [username]);
    if (userRows.length === 0) return res.status(404).json({ error: 'No account found with that username.' });

    const { rows: questionRows } = await db.query(
      'SELECT question_key FROM user_security_answers WHERE user_id = $1 ORDER BY answer_id',
      [userRows[0].user_id]
    );
    if (questionRows.length === 0) {
      // Should not happen for any account created after this stage, but an older seeded/admin
      // account could in principle have none — fail clearly rather than send back an empty list.
      return res.status(409).json({ error: 'This account has no security questions on file. Ask a system administrator for help.' });
    }
    res.json({ questionKeys: questionRows.map((r) => r.question_key) });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/forgot-password/verify  body: { username, answers: [{questionKey, answer}, {questionKey, answer}] }
 * Step 2. Both answers must match (case/space-insensitive). On success, issues a short-lived
 * reset token (15 minutes) — NOT a login token — that only the next step, resetPassword, accepts.
 */
async function forgotPasswordVerify(req, res, next) {
  try {
    const username = normalizeUsername(req.body.username);
    const answers = req.body.answers;
    if (!username || !Array.isArray(answers) || answers.length !== 2) {
      return res.status(400).json({ error: 'Username and both security answers are required.' });
    }

    const { rows: userRows } = await db.query('SELECT user_id, password_hash FROM users WHERE username = $1', [username]);
    if (userRows.length === 0) return res.status(404).json({ error: 'No account found with that username.' });
    const userId = userRows[0].user_id;

    const { rows: storedRows } = await db.query(
      'SELECT question_key, answer_hash FROM user_security_answers WHERE user_id = $1',
      [userId]
    );
    const storedByKey = new Map(storedRows.map((r) => [r.question_key, r.answer_hash]));

    for (const a of answers) {
      const storedHash = storedByKey.get(a.questionKey);
      if (!storedHash) return res.status(401).json({ error: 'One or more answers are incorrect.' });
      const match = await bcrypt.compare(normalizeAnswer(a.answer), storedHash);
      if (!match) return res.status(401).json({ error: 'One or more answers are incorrect.' });
    }

    const resetToken = signResetToken(userId, userRows[0].password_hash);
    res.json({ resetToken });
  } catch (err) {
    next(err);
  }
}

/** POST /api/auth/forgot-password/reset  body: { resetToken, newPassword }  Step 3 — final step. */
async function forgotPasswordReset(req, res, next) {
  try {
    const { resetToken, newPassword } = req.body;
    if (!resetToken || !newPassword) return res.status(400).json({ error: 'resetToken and newPassword are required.' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });

    const decoded = verifyResetToken(resetToken);
    if (!decoded) return res.status(401).json({ error: 'This password reset link has expired. Please start again.' });

    // The token is only honoured if the account's password hash is still exactly what it was
    // when this token was issued. The first successful reset changes it, so a second attempt
    // with the same (still validly signed, still unexpired) token is refused here — see the
    // comment on signResetToken in middleware/auth.js for why.
    const { rows } = await db.query('SELECT password_hash FROM users WHERE user_id = $1', [decoded.userId]);
    if (rows.length === 0 || passwordFingerprint(rows[0].password_hash) !== decoded.pwv) {
      return res.status(401).json({ error: 'This password reset link has already been used or is no longer valid. Please start again.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db.query(
      `UPDATE users SET password_hash = $1, must_change_password = FALSE, updated_at = NOW() WHERE user_id = $2`,
      [passwordHash, decoded.userId]
    );
    res.json({ success: true });
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

module.exports = {
  register, login, logout, me, changePassword,
  forgotPasswordStart, forgotPasswordVerify, forgotPasswordReset,
};
