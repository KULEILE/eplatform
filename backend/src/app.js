const express = require('express');
const cors = require('cors');
const path = require('path');
const errorHandler = require('./middleware/errorHandler');
const { UPLOAD_DIR } = require('./middleware/upload');

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

const app = express();

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '5mb' }));

// Uploaded logos and (in a real deployment, access-controlled) documents. For this prototype,
// static serving is fine for demo logos; real document access still goes through the API.
app.use('/uploads', express.static(UPLOAD_DIR));

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

app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }));
app.use(errorHandler);

module.exports = app;
