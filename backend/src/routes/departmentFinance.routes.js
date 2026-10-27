const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const c = require('../controllers/departmentFinance.controller');

const router = express.Router();
router.use(requireAuth);
router.post('/context', requireRole('department_finance_admin'), c.switchContext);

module.exports = router;
