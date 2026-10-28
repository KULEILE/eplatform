const express = require('express');
const { requireAuth } = require('../middleware/auth');
const c = require('../controllers/pensions.controller');

const router = express.Router();
router.use(requireAuth);
router.post('/apply', c.apply);
router.get('/', c.list);

// Pensioner roster, disbursement and totals — registered before the generic '/:id' routes
// below so 'pensioners' is never mistaken for a record id.
router.get('/pensioners', c.listPensioners);
router.patch('/pensioners/:id/amount', c.setPensionAmount);
router.post('/pensioners/:id/pay', c.payPension);
router.get('/pensioners/:id/payments', c.listPensionPayments);

router.get('/:id', c.getOne);
router.post('/:id/resubmit', c.resubmit);
router.post('/:id/request-information', c.requestInformation);
router.post('/:id/reject', c.reject);
router.post('/:id/:action', c.transition);

module.exports = router;
