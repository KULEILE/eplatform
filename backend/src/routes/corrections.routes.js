const express = require('express');
const { requireAuth } = require('../middleware/auth');
const cc = require('../controllers/corrections.controller');

const router = express.Router();
router.use(requireAuth);
router.post('/', cc.submitCorrection);
router.get('/', cc.listCorrections);
router.post('/:id/decide', cc.decideCorrection);

module.exports = router;
