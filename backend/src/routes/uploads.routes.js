const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { uploadPhoto: uploadPhotoMw, uploadReceipt: uploadReceiptMw } = require('../middleware/upload');
const uc = require('../controllers/uploads.controller');

const router = express.Router();
router.use(requireAuth);

router.post('/photo', uploadPhotoMw.single('photo'), uc.uploadPhoto);
router.post('/receipt', uploadReceiptMw.single('receipt'), uc.uploadReceipt);

module.exports = router;