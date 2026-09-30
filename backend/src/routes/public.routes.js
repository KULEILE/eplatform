const express = require('express');
const admin = require('../controllers/admin.controller');

// No auth required — the header/login page needs branding before anyone signs in.
const router = express.Router();
router.get('/settings', admin.getPublicSettings);

module.exports = router;
