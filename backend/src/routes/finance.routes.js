const express = require('express');
const { requireAuth } = require('../middleware/auth');
const c = require('../controllers/finance.controller');

const router = express.Router();
router.use(requireAuth);
router.post('/apply', c.apply);
router.get('/', c.list);

// Government employment record (see finance.controller.js) — registered before the generic
// '/:id' routes below so 'government-employment' is never mistaken for a record id/action.
router.get('/government-employment/:permanentIdentityNumber', c.lookupGovernmentEmployment);
router.post('/government-employment/declare', c.declareGovernmentEmployee);

// Retirement benefits tracking (service #2) and Budget/Tender publications (service #5) — both
// registered before the generic '/:id' routes below for the same reason as
// government-employment above.
router.get('/retirement-tracking', c.retirementTracking);
router.get('/publications', c.listPublications);
router.post('/publications', c.createPublication);
router.patch('/publications/:id/active', c.setPublicationActive);

// Employee roster and payroll — registered before the generic '/:id' routes below for the same
// reason as government-employment/retirement-tracking/publications above.
router.get('/employees', c.listEmployees);
router.patch('/employees/:citizenId/salary', c.setEmployeeSalary);
router.post('/employees/:citizenId/pay', c.paySalary);
router.get('/employees/:citizenId/payments', c.listSalaryPayments);

router.get('/:id', c.getOne);
router.post('/:id/resubmit', c.resubmit);
router.post('/:id/request-information', c.requestInformation);
router.post('/:id/reject', c.reject);
router.post('/:id/:action', c.transition);

module.exports = router;
