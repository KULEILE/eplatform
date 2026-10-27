const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const c = require('../controllers/branchBudget.controller');

const router = express.Router();
router.use(requireAuth);
router.post('/', requireRole('branch_admin'), c.apply);
router.get('/', requireRole('branch_admin', 'finance_officer', 'system_administrator'), c.list);
router.post('/:id/:action', requireRole('finance_officer', 'system_administrator'), c.transition);

module.exports = router;
