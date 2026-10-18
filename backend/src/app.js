const express = require('express');
const cors = require('cors');
const errorHandler = require('./middleware/errorHandler');
const db = require('./config/db');

const authRoutes = require('./routes/auth.routes');
const identityRoutes = require('./routes/identity.routes');
const citizenRoutes = require('./routes/citizen.routes');
const homeAffairsRoutes = require('./routes/homeAffairs.routes');
const trafficRoutes = require('./routes/traffic.routes');
const financeRoutes = require('./routes/finance.routes');
const pensionsRoutes = require('./routes/pensions.routes');
const policeRoutes = require('./routes/police.routes');
const passportRoutes = require('./routes/passport.routes');
const applicationsRoutes = require('./routes/applications.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const adminRoutes = require('./routes/admin.routes');
const auditLogsRoutes = require('./routes/auditLogs.routes');
const departmentsRoutes = require('./routes/departments.routes');
const publicRoutes = require('./routes/public.routes');
const officesRoutes = require('./routes/offices.routes');
const districtsRoutes = require('./routes/districts.routes');
const uploadsRoutes = require('./routes/uploads.routes');
const appointmentsRoutes = require('./routes/appointments.routes');
const correctionsRoutes = require('./routes/corrections.routes');

const app = express();

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '5mb' }));

// Uploaded photos, receipts, biometric captures, signatures and the system logo. These used to
// be served straight off local disk (express.static), but local disk doesn't survive a redeploy
// or idle spin-down on hosts with an ephemeral filesystem (e.g. Render's free tier) — see
// migration 050. They're now stored in the file_blobs table, so this route looks them up there
// instead; every existing "/uploads/<reference>" URL built by the frontend keeps working
// unchanged, since file_key uses the exact same "photos/<name>" shape the old disk paths did.
app.get('/uploads/*', async (req, res) => {
  try {
    const fileKey = req.params[0];
    const { rows } = await db.query('SELECT mime_type, data FROM file_blobs WHERE file_key = $1', [fileKey]);
    if (rows.length === 0) return res.status(404).json({ error: 'File not found.' });
    res.set('Content-Type', rows[0].mime_type);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(rows[0].data);
  } catch (err) {
    res.status(500).json({ error: 'Could not load file.' });
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', prototype: true, demoData: true }));

app.use('/api/auth', authRoutes);
app.use('/api/identity', identityRoutes);
app.use('/api/citizen', citizenRoutes);
app.use('/api/home-affairs', homeAffairsRoutes);
app.use('/api/traffic', trafficRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/pensions', pensionsRoutes);
app.use('/api/police', policeRoutes);
app.use('/api/passport', passportRoutes);
app.use('/api/applications', applicationsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/audit-logs', auditLogsRoutes);
app.use('/api/departments', departmentsRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/offices', officesRoutes);
app.use('/api/districts', districtsRoutes);
app.use('/api/uploads', uploadsRoutes);
app.use('/api/appointments', appointmentsRoutes);
app.use('/api/corrections', correctionsRoutes);

app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }));
app.use(errorHandler);

module.exports = app;
