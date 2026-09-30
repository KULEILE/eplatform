const express = require('express');
const { requireAuth } = require('../middleware/auth');
const pc = require('../controllers/police.controller');
const pcc = require('../controllers/policeClearance.controller');

const router = express.Router();
router.use(requireAuth);

router.post('/identity-verification', pc.performLookup);
router.get('/identity-verification', pc.listLookups);
router.get('/identity-verification/:id', pc.getLookup);

// Police Clearance Certificate — citizen-facing self-service, kept separate from the
// officer-only identity-verification lookup above.
router.post('/clearance/apply', pcc.apply);
router.get('/clearance', pcc.list);
router.get('/clearance/:id', pcc.getOne);
router.get('/clearance/:id/certificate', pcc.getCertificate);
router.post('/clearance/:id/request-information', pcc.requestInformation);
router.post('/clearance/:id/reject', pcc.reject);
router.post('/clearance/:id/:action', pcc.transition);

module.exports = router;
