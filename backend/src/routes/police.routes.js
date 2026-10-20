const express = require('express');
const { requireAuth } = require('../middleware/auth');
const pc = require('../controllers/police.controller');
const pcc = require('../controllers/policeClearance.controller');
const pcase = require('../controllers/policeCase.controller');

const router = express.Router();
router.use(requireAuth);

router.post('/identity-verification', pc.performLookup);
router.post('/identity-verification/biometric-search', pc.searchByHandBiometric);
router.get('/identity-verification', pc.listLookups);
router.get('/identity-verification/:id', pc.getLookup);

// Police Clearance Certificate — citizen-facing self-service, kept separate from the
// officer-only identity-verification lookup above.
router.post('/clearance/apply', pcc.apply);
router.get('/clearance', pcc.list);
router.get('/clearance/:id', pcc.getOne);
router.get('/clearance/:id/history', pcc.getHistory);
router.get('/clearance/:id/certificate', pcc.getCertificate);
router.post('/clearance/:id/request-information', pcc.requestInformation);
router.post('/clearance/:id/reject', pcc.reject);
router.post('/clearance/:id/resubmit', pcc.resubmit);
router.post('/clearance/:id/:action', pcc.transition);

// Case / arrest / sentence recording — the officer-initiated side of the department (see
// policeCase.controller.js). /cases/citizen-history must be registered before /cases/:id so
// Express doesn't try to match "citizen-history" as a numeric :id first.
router.get('/cases/citizen-history', pcase.citizenHistory);
router.post('/cases', pcase.startCase);
router.get('/cases', pcase.listCases);
router.get('/cases/:id', pcase.getCase);
router.patch('/cases/:id/status', pcase.setCaseStatus);
router.post('/cases/:id/arrests', pcase.recordArrest);
router.post('/cases/:id/sentences', pcase.recordSentence);

module.exports = router;
