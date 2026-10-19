const express = require('express');
const { requireAuth } = require('../middleware/auth');
const bc = require('../controllers/biometrics.controller');

const router = express.Router();
router.use(requireAuth);

router.post('/enroll', bc.enrollHand);
router.get('/status', bc.getBiometricStatus);

module.exports = router;
