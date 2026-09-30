const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin, requireRole } = require('../middleware/rbac');
const { uploadLogo: uploadLogoMw } = require('../middleware/upload');
const admin = require('../controllers/admin.controller');

// Platform-wide configuration (branding, audit trail, department list) stays strictly
// System Administrator only. Employee account management is shared with Branch Administrators,
// who may only act within their own branch — enforced inside the controller.
const router = express.Router();
router.use(requireAuth);

router.get('/settings', requireAdmin, admin.getSettings);
router.put('/settings', requireAdmin, admin.updateSettings);
router.post('/logo', requireAdmin, uploadLogoMw.single('logo'), admin.uploadLogo);
router.delete('/logo', requireAdmin, admin.removeLogo);

const requireAccountManager = requireRole('system_administrator', 'branch_admin');
router.get('/users', requireAccountManager, admin.listUsers);
router.post('/users', requireAccountManager, admin.createUser);
router.patch('/users/:id', requireAccountManager, admin.updateUser);

router.get('/audit', requireAdmin, admin.listAuditLogs);
router.get('/departments', requireAdmin, admin.listDepartments);
router.get('/stats', requireAdmin, admin.getStats);

module.exports = router;
