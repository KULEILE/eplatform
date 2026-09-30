const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getProfile } = require('../controllers/citizen.controller');

const router = express.Router();
router.get('/profile', requireAuth, getProfile);

module.exports = router;
