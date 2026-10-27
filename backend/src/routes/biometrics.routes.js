const express = require('express');
const { requireAuth } = require('../middleware/auth');
const bc = require('../controllers/biometrics.controller');

const router = express.Router();
router.use(requireAuth);

// POST /enroll (citizen self-enrolment) removed in Batch 29 — see biometrics.controller.js's
// removal note. Hand biometrics are now only ever captured officer-administered, in person.
router.get('/status', bc.getBiometricStatus);

module.exports = router;
