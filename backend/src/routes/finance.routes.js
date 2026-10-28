const express = require('express');
const { requireAuth } = require('../middleware/auth');
const c = require('../controllers/finance.controller');
const pub = require('../controllers/financePublications.controller');

const router = express.Router();
router.use(requireAuth);
router.post('/apply', c.apply);
router.get('/', c.list);

// Government employment record (see finance.controller.js) — registered before the generic
// '/:id' routes below so 'government-employment' is never mistaken for a record id/action.
router.get('/government-employment/:permanentIdentityNumber', c.lookupGovernmentEmployment);
router.post('/government-employment/declare', c.declareGovernmentEmployee);

// Budget documents and tender announcements — also registered before the '/:id' routes.
router.get('/publications', pub.listPublications);
router.post('/publications', pub.uploadPublicationFile, pub.createPublication);
router.patch('/publications/:publicationId', pub.setPublicationActive);

router.get('/:id', c.getOne);
router.post('/:id/resubmit', c.resubmit);
router.post('/:id/request-information', c.requestInformation);
router.post('/:id/reject', c.reject);
router.post('/:id/:action', c.transition);

module.exports = router;