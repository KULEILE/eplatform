const express = require('express');
const { requireAuth } = require('../middleware/auth');
const pc = require('../controllers/passport.controller');

const router = express.Router();
router.use(requireAuth);

router.post('/apply', pc.apply);
router.get('/', pc.list);
router.get('/:id', pc.getOne);
router.post('/:id/request-information', pc.requestInformation);
router.post('/:id/reject', pc.reject);
router.post('/:id/:action', pc.transition);

module.exports = router;
