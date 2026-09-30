const express = require('express');
const { requireAuth } = require('../middleware/auth');
const admin = require('../controllers/admin.controller');

// Any authenticated user (citizen or employee) needs the department list for the
// "Choose a Government Department" screen — this is intentionally not admin-only.
const router = express.Router();
router.get('/', requireAuth, admin.listDepartments);

module.exports = router;
