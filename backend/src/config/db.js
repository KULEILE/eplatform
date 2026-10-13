const { Pool, types } = require('pg');

// Keep PostgreSQL DATE columns as YYYY-MM-DD strings to prevent timezone changes.
types.setTypeParser(1082, (value) => value);

const connectionString = process.env.DATABASE_URL || 'postgresql://eportal_user:YOUR_PASSWORD@dpg-daj4ltnqj5pc73c7v5d0-a.oregon-postgres.render.com/eportal?sslmode=require';

// Hosted PostgreSQL requires SSL; local PostgreSQL does not.
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