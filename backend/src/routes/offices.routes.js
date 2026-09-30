const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');
const offices = require('../controllers/offices.controller');

// Any authenticated user needs the district/branch list — citizens pick a branch when they
// apply, admins/branch admins pick one when assigning an employee.
const router = express.Router();
router.get('/', requireAuth, offices.listOffices);

// System Administrator only — opening and managing branch offices across every department.
router.get('/all', requireAuth, requireAdmin, offices.listAllOffices);
router.post('/', requireAuth, requireAdmin, offices.createOffice);
router.patch('/:id', requireAuth, requireAdmin, offices.updateOffice);

module.exports = router;
