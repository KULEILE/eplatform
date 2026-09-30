/**
 * One-off helper: marks migrations 001-021 as already applied in schema_migrations, without
 * re-running their SQL. Use this only on a database that was already fully set up under the
 * OLD schema (i.e. everything through 021) before the districts/branch-admin migrations (022,
 * 023) existed — that's exactly the situation with the original Render database.
 *
 * Usage: DATABASE_URL=<your connection string> node mark-existing.js
 */
const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Set DATABASE_URL first, e.g.:\n  $env:DATABASE_URL="postgresql://...`');
  process.exit(1);
}

const ALREADY_APPLIED = [
  '001_create_roles.sql',
  '002_create_departments.sql',
  '003_create_citizens.sql',
  '004_create_users.sql',
  '005_create_birth_records.sql',
  '006_create_birth_certificates.sql',
  '007_create_national_id_cards.sql',
  '008_create_passport_records.sql',
  '009_create_traffic_records.sql',
  '010_create_finance_records.sql',
  '011_create_pension_records.sql',
  '012_create_police_records.sql',
  '013_create_applications.sql',
  '014_create_application_documents.sql',
  '015_create_notifications.sql',
  '016_create_audit_logs.sql',
  '017_create_appointments.sql',
  '018_create_system_settings.sql',
  '019_add_deferred_foreign_keys.sql',
  '020_create_corrections_and_death.sql',
  '021_create_application_status_history.sql',
];

async function main() {
  const isLocal = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
  const client = new Client({ connectionString: DATABASE_URL, ssl: isLocal ? false : { rejectUnauthorized: false } });
  await client.connect();
  console.log(`Connected to ${DATABASE_URL.replace(/:[^:@]*@/, ':****@')}`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  for (const file of ALREADY_APPLIED) {
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
    console.log(`- marked ${file} as already applied`);
  }

  console.log('Done. Now run: node run-migrations.js  (it will only apply 022 and 023)');
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
