const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const c = require('../controllers/financialIssue.controller');

const router = express.Router();
router.use(requireAuth);
router.post('/', requireRole('citizen'), c.apply);
router.get('/', requireRole('department_finance_admin'), c.listForAdmin);
router.post('/:id/resolve', requireRole('department_finance_admin'), c.resolve);
router.post('/:id/escalate', requireRole('department_finance_admin'), c.escalate);

module.exports = router;
