const express = require('express');
const { requireAuth } = require('../middleware/auth');
const c = require('../controllers/traffic.controller');
const c2 = require('../controllers/trafficServices2.controller');
const dl = require('../controllers/drivingLicence.controller');

const router = express.Router();
router.use(requireAuth);

// Driving theory/practical test bookings — registered BEFORE the generic '/:id' routes below so
// '/test-bookings' is never swallowed by the single-segment '/:id' pattern.
router.post('/test-bookings', c2.requestTestBooking);
router.get('/test-bookings', c2.listTestBookings);
router.get('/test-bookings/:id', c2.getTestBooking);
router.post('/test-bookings/:id/schedule-practical', c2.schedulePracticalTest);
router.post('/test-bookings/:id/postpone', c2.postponeTestBooking);
router.post('/test-bookings/:id/record-result', c2.recordTestResult);
router.post('/test-bookings/:id/cancel', c2.cancelTestBooking);
router.post('/test-bookings/:id/reject', c2.rejectTestBooking);
router.get('/test-bookings/:id/theory-test', c2.getTheoryTest);
router.post('/test-bookings/:id/submit-answers', c2.submitTheoryAnswers);

// Theory test sessions (migration 068) — the shared, officer-published, multiple-choice question
// set every citizen writing the theory test on a given day at a given office sits. Registered
// here, before '/:id/:action' below, for the same route-ordering reason as everything else in
// this block: a two-segment literal path must come before the generic single-segment catch-all.
router.post('/theory-sessions', c2.upsertTheorySession);
router.get('/theory-sessions', c2.listTheorySessions);
router.post('/theory-sessions/:id/publish', c2.publishTheorySession);
router.post('/theory-sessions/:id/postpone', c2.postponeTheorySession);

// Driving Licence — Application/Renewal/Replacement, consolidated onto one bespoke controller
// (migration 067). Registered BEFORE the generic '/:id/:action' catch-all below, for the same
// reason as test-bookings/inspections/transport-permits: '/driving-licence/apply' is two path
// segments and would otherwise be swallowed by '/:id/:action' with id='driving-licence'.
router.get('/driving-licence/eligibility', dl.getEligibility);
router.post('/driving-licence/apply', dl.apply);
router.get('/driving-licence', dl.list);
router.get('/driving-licence/:id', dl.getOne);
router.post('/driving-licence/:id/resubmit', dl.resubmit);
router.post('/driving-licence/:id/request-information', dl.requestInformation);
router.post('/driving-licence/:id/reject', dl.reject);
router.post('/driving-licence/:id/surrender-failed', dl.failSurrender);
router.post('/driving-licence/:id/:action', dl.transition);

// Roadworthiness test & Certificate of Fitness — its own sub-resource, same apply/list/get/
// transition/resubmit/request-information/reject shape as traffic_records below.
router.post('/inspections/apply', c2.vehicleInspectionsController.apply);
router.get('/inspections', c2.vehicleInspectionsController.list);
router.get('/inspections/:id', c2.vehicleInspectionsController.getOne);
router.post('/inspections/:id/resubmit', c2.vehicleInspectionsController.resubmit);
router.post('/inspections/:id/request-information', c2.vehicleInspectionsController.requestInformation);
router.post('/inspections/:id/reject', c2.vehicleInspectionsController.reject);
router.post('/inspections/:id/:action', c2.vehicleInspectionsController.transition);

// Transport operating permits (new or renewal).
router.post('/transport-permits/apply', c2.transportPermitsController.apply);
router.get('/transport-permits', c2.transportPermitsController.list);
router.get('/transport-permits/:id', c2.transportPermitsController.getOne);
router.post('/transport-permits/:id/resubmit', c2.transportPermitsController.resubmit);
router.post('/transport-permits/:id/request-information', c2.transportPermitsController.requestInformation);
router.post('/transport-permits/:id/reject', c2.transportPermitsController.reject);
router.post('/transport-permits/:id/:action', c2.transportPermitsController.transition);

// Driving instructor & examiner certification — admin registry, no citizen applicant.
router.post('/instructors', c2.createDrivingInstructor);
router.get('/instructors', c2.listDrivingInstructors);
router.get('/instructors/:id', c2.getDrivingInstructor);
router.post('/instructors/:id/status', c2.updateDrivingInstructorStatus);

// Original five service types plus the eight added in migration 042, all on traffic_records.
router.post('/apply', c.apply);
router.get('/', c.list);
router.get('/:id', c.getOne);
router.post('/:id/resubmit', c.resubmit);
router.post('/:id/request-information', c.requestInformation);
router.post('/:id/reject', c.reject);
router.post('/:id/:action', c.transition);

module.exports = router;
