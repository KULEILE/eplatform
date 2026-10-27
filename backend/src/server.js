require('dotenv').config();
const app = require('./app');
const { pool } = require('./config/db');
const { sweepExpiredTemporaryPermits } = require('./controllers/traffic.controller');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Integrated Government Services API listening on http://localhost:${PORT}`);
});

// Batch 30 — "the system should automatically generate the temporary permit after registration
// which last only 21 days after that days it must generate number plate automatically." This is
// the real automatic mechanism: this backend runs as a single long-lived process (on Render — see
// frontend/vercel.json's proxy target), not as short-lived serverless functions, so a plain
// interval timer is the natural fit — no external cron service to wire up or depend on staying
// configured. An hourly tick is far more often than the 21-day window needs, which just means a
// plate is never more than an hour late; traffic.controller.js's listWithSweep also does the same
// check lazily on every list() call, so in practice a plate typically appears the moment anyone
// next loads a traffic page after expiry, not after waiting for the tick. Runs once immediately on
// startup too, so a permit that expired while the server was down (a deploy, a restart) is caught
// up right away rather than waiting up to an hour.
const TEMP_PERMIT_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
function runTemporaryPermitSweep() {
  sweepExpiredTemporaryPermits()
    .then((issued) => {
      if (issued > 0) {
        // eslint-disable-next-line no-console
        console.log(`Temporary permit sweep: auto-issued ${issued} number plate(s) for expired permit(s).`);
      }
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`Temporary permit sweep failed: ${err.message}`);
    });
}
runTemporaryPermitSweep();
setInterval(runTemporaryPermitSweep, TEMP_PERMIT_SWEEP_INTERVAL_MS);

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
