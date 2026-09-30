const { Pool, types } = require('pg');

// By default, node-postgres turns a DATE column (e.g. date_of_birth = '2005-09-02') into a
// JavaScript Date object representing midnight in the SERVER'S LOCAL TIME ZONE — not UTC. That
// is harmless on its own, but the moment that Date object is sent to the browser as JSON,
// JavaScript converts it to UTC to make it a string. If the server's clock happens to be set
// AHEAD of UTC (which is normal for anything running on a Lesotho-local clock), local midnight
// falls on the PREVIOUS UTC day — so the date that comes back out is silently one day earlier
// than what was actually stored, purely depending on the server's time zone at that moment.
// The fix: tell node-postgres to hand DATE columns back exactly as Postgres stores them — a
// plain 'YYYY-MM-DD' string — so they never pass through a Date object or a time zone
// conversion at all. OID 1082 is Postgres's internal type id for DATE.
types.setTypeParser(1082, (value) => value);

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/gov_services';
// Hosted providers (Render, Supabase, RDS, etc.) require SSL on external connections;
// local/dev Postgres does not support it, so only enable it for non-local hosts.
const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 8000,
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('Unexpected error on idle PostgreSQL client', err);
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
};
