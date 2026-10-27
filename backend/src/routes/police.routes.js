const express = require('express');
const { requireAuth } = require('../middleware/auth');
const pc = require('../controllers/police.controller');
const pcc = require('../controllers/policeClearance.controller');
const pcase = require('../controllers/policeCase.controller');
const preports = require('../controllers/policeReports.controller');

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
// policeCase.controller.js). /cases/citizen-history and /cases/track must be registered before
// /cases/:id so Express doesn't try to match either as a numeric :id first.
router.get('/cases/citizen-history', pcase.citizenHistory);
router.get('/cases/track', pcase.trackCase);
router.post('/cases', pcase.startCase);
router.get('/cases', pcase.listCases);
router.get('/cases/:id', pcase.getCase);
router.patch('/cases/:id/status', pcase.setCaseStatus);
router.post('/cases/:id/arrests', pcase.recordArrest);
router.post('/cases/:id/sentences', pcase.recordSentence);

// Sentence corrections (Batch 34): an officer requests a change, only an administrator can
// approve/reject it — see policeCase.controller.js's requestSentenceAmendment/
// approveSentenceAmendment/rejectSentenceAmendment and migration 077.
router.post('/sentences/:sentenceId/amendment-requests', pcase.requestSentenceAmendment);
router.get('/sentence-amendment-requests', pcase.listSentenceAmendmentRequests);
router.post('/sentence-amendment-requests/:id/approve', pcase.approveSentenceAmendment);
router.post('/sentence-amendment-requests/:id/reject', pcase.rejectSentenceAmendment);

// Citizen-facing incident/request reporting — the eight reporting services plus Information
// Requests (migration 055, policeReports.controller.js), on the same generic
// apply/list/get/transition/resubmit/request-information/reject shape as everything else built
// on simpleDepartmentController.
router.post('/reports/apply', preports.apply);
router.get('/reports', preports.list);
router.get('/reports/:id', preports.getOne);
router.post('/reports/:id/resubmit', preports.resubmit);
router.post('/reports/:id/request-information', preports.requestInformation);
router.post('/reports/:id/reject', preports.reject);
router.post('/reports/:id/:action', preports.transition);

module.exports = router;
