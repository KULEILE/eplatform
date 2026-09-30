const express = require('express');
const { requireAuth } = require('../middleware/auth');
const offices = require('../controllers/offices.controller');

const router = express.Router();
router.get('/', requireAuth, offices.listDistricts);

module.exports = router;
