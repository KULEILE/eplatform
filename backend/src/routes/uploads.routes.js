const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { uploadPhoto: uploadPhotoMw } = require('../middleware/upload');
const uc = require('../controllers/uploads.controller');

const router = express.Router();
router.use(requireAuth);

router.post('/photo', uploadPhotoMw.single('photo'), uc.uploadPhoto);

module.exports = router;
