const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  uploadPhoto: uploadPhotoMw, uploadReceipt: uploadReceiptMw,
  uploadBiometric: uploadBiometricMw, uploadSignature: uploadSignatureMw,
} = require('../middleware/upload');
const uc = require('../controllers/uploads.controller');

const router = express.Router();
router.use(requireAuth);

router.post('/photo', uploadPhotoMw.single('photo'), uc.uploadPhoto);
router.post('/receipt', uploadReceiptMw.single('receipt'), uc.uploadReceipt);
router.post('/biometric', uploadBiometricMw.single('biometric'), uc.uploadBiometric);
router.post('/signature', uploadSignatureMw.single('signature'), uc.uploadSignature);
router.get('/photo-note/:subdir/:filename', uc.getPhotoComplianceNote);

module.exports = router;
