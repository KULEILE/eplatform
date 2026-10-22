const express = require('express');
const { uploadApplicationDocument: uploadApplicationDocumentMw } = require('../middleware/upload');
const { uploadApplicationDocument } = require('../controllers/uploads.controller');
const { applyForBirthCertificatePublic } = require('../controllers/homeAffairs.controller');

// UNAUTHENTICATED on purpose, for the whole router — this is the public entry point for an
// adult with no citizen record and no account at all, applying for their own birth certificate
// as the first step toward getting one (see migration 059, homeAffairs.controller.js's
// applyForBirthCertificatePublic, and frontend/src/pages/BirthCertificateApplication.jsx).
// Everything here lives outside /api/home-affairs on purpose too, since that whole router
// requires a session (see homeAffairs.routes.js's router.use(requireAuth)).
const router = express.Router();

router.post('/upload', uploadApplicationDocumentMw.single('document'), uploadApplicationDocument);
router.post('/', applyForBirthCertificatePublic);

module.exports = router;
