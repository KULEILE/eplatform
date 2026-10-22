/**
 * One-off helper: creates the very first System Administrator account directly in the
 * database. Normal admin accounts are only created by an existing System Administrator
 * through the app itself — but you need at least one to exist before that's possible, so
 * this script bypasses the API for that first account only.
 *
 * Usage:
 *   $env:DATABASE_URL="<your connection string>"
 *   node bootstrap-admin.js <username> <email> <phone> <password>
 *
 * Example:
 *   node bootstrap-admin.js kuleile kuleilesamareli@gmail.com +26658000000 "SomeStrongPassword1"
 *
 * Username + password is what you actually log in with (see Stage 2 of the project plan).
 * Email is optional now, but this script still asks for one so the very first admin account has
 * something to tell other staff, exactly as it did before.
 */
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
const [, , username, email, phone, password] = process.argv;
const USERNAME_RE = /^[a-z0-9_.]{3,50}$/;

if (!DATABASE_URL) {
  console.error('Set DATABASE_URL first, e.g.:\n  $env:DATABASE_URL="postgresql://..."');
  process.exit(1);
}
if (!username || !password) {
  console.error('Usage: node bootstrap-admin.js <username> <email> <phone> <password>');
  process.exit(1);
}
if (!USERNAME_RE.test(username.toLowerCase())) {
  console.error('Username must be 3–50 characters, using only lowercase letters, numbers, "_" or ".".');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

async function main() {
  const isLocal = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
  const client = new Client({ connectionString: DATABASE_URL, ssl: isLocal ? false : { rejectUnauthorized: false } });
  await client.connect();
  console.log(`Connected to ${DATABASE_URL.replace(/:[^:@]*@/, ':****@')}`);

  const { rows: roleRows } = await client.query("SELECT role_id FROM roles WHERE role_key = 'system_administrator'");
  if (roleRows.length === 0) {
    console.error("No 'system_administrator' role found — make sure migrations have been run.");
    await client.end();
    process.exit(1);
  }
  const roleId = roleRows[0].role_id;

  const usernameLower = username.toLowerCase();
  const { rows: existing } = await client.query('SELECT user_id FROM users WHERE username = $1 OR (email IS NOT NULL AND email = $2)', [usernameLower, email || null]);
  if (existing.length > 0) {
    console.error(`A user with that username or email already exists (user_id ${existing[0].user_id}). Not creating a duplicate.`);
    await client.end();
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const { rows } = await client.query(
    `INSERT INTO users (username, email, phone, password_hash, role_id, account_status, must_change_password)
     VALUES ($1, $2, $3, $4, $5, 'Active', FALSE)
     RETURNING user_id, username, email`,
    [usernameLower, email || null, phone || null, passwordHash, roleId]
  );

  console.log(`Created System Administrator account: ${rows[0].username} (user_id ${rows[0].user_id})`);
  console.log('You can log in with this username and the password you just set.');
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
