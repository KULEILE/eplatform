const express = require('express');
const { requireAuth } = require('../middleware/auth');
const c = require('../controllers/pensions.controller');

const router = express.Router();
router.use(requireAuth);
router.post('/apply', c.apply);
router.get('/', c.list);
router.get('/:id', c.getOne);
router.post('/:id/request-information', c.requestInformation);
router.post('/:id/reject', c.reject);
router.post('/:id/:action', c.transition);

module.exports = router;
