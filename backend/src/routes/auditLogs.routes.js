const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');
const admin = require('../controllers/admin.controller');

// Matches the API surface named in the assignment brief: GET /api/audit-logs
const router = express.Router();
router.get('/', requireAuth, requireAdmin, admin.listAuditLogs);

module.exports = router;
