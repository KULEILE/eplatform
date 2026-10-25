const express = require('express');
const { requireAuth } = require('../middleware/auth');
const pc = require('../controllers/passport.controller');

const router = express.Router();
router.use(requireAuth);

router.post('/apply', pc.apply);
router.post('/renew', pc.applyRenewal);
router.post('/replace', pc.applyReplacement);
router.get('/', pc.list);
// Must come before the generic '/:id' route below, or a GET here would be captured as :id='eligibility'.
router.get('/eligibility', pc.getEligibility);
router.get('/:id', pc.getOne);
router.post('/:id/request-information', pc.requestInformation);
router.post('/:id/reject', pc.reject);
router.post('/:id/resubmit', pc.resubmit);
// Batch 14 — must come before the generic '/:id/:action' catch-all below, or that route would
// capture these two literal paths as :action='surrender' / 'surrender-failed' and pc.transition
// would reject them as an unknown action before these dedicated handlers ever ran.
router.post('/:id/surrender', pc.verifySurrender);
router.post('/:id/surrender-failed', pc.failSurrender);
router.post('/:id/:action', pc.transition);

module.exports = router;
