require('dotenv').config();
const app = require('./app');
const { pool } = require('./config/db');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Integrated Government Services API listening on http://localhost:${PORT}`);
});

// The server above starts (and serves requests) regardless of the DB check below —
// this just reports connectivity so you know at a glance whether it reached the database.
pool.query('SELECT NOW()')
  .then((result) => {
    // eslint-disable-next-line no-console
    console.log(`Connected to database — server time: ${result.rows[0].now}`);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`Failed to connect to database: ${err.message}`);
  });
