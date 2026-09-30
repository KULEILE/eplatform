const express = require('express');
const { requireAuth } = require('../middleware/auth');
const nc = require('../controllers/notifications.controller');

const router = express.Router();
router.use(requireAuth);
router.get('/', nc.list);
router.post('/:id/read', nc.markRead);
router.post('/read-all', nc.markAllRead);

module.exports = router;
