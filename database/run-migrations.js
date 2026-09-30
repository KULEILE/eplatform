/**
 * Applies every .sql file in ./migrations, in filename order, inside a single transaction
 * per file. Tracks applied migrations in a schema_migrations table so re-running is safe.
 *
 * Usage: DATABASE_URL=postgres://user:pass@localhost:5432/gov_services node run-migrations.js
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/gov_services';
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
// Hosted providers (Render, Supabase, RDS, etc.) require SSL on external connections.
const isLocal = /localhost|127\.0\.0\.1/.test(DATABASE_URL);

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: isLocal ? false : { rejectUnauthorized: false } });
  await client.connect();
  console.log(`Connected to ${DATABASE_URL.replace(/:[^:@]*@/, ':****@')}`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows: applied } = await client.query('SELECT filename FROM schema_migrations');
  const appliedSet = new Set(applied.map((r) => r.filename));

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`- skip  ${file} (already applied)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`- apply ${file}`);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  FAILED on ${file}:`, err.message);
      process.exitCode = 1;
      await client.end();
      return;
    }
  }

  console.log('All migrations applied successfully.');
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
