const express = require('express');
const { requireAuth } = require('../middleware/auth');
const appointments = require('../controllers/appointments.controller');

const router = express.Router();
router.use(requireAuth);

router.post('/', appointments.create);
router.get('/', appointments.list);
router.get('/:id', appointments.getOne);
router.patch('/:id/status', appointments.updateStatus);

module.exports = router;
