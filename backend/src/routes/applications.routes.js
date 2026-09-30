const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { uploadDocument: uploadMw } = require('../middleware/upload');
const ac = require('../controllers/applications.controller');

const router = express.Router();
router.use(requireAuth);

router.get('/', ac.list);
router.get('/:id', ac.getOne);
router.post('/:id/documents', uploadMw.single('file'), ac.uploadDocument);
router.post('/documents/:documentId/verify', ac.verifyDocument);

module.exports = router;
