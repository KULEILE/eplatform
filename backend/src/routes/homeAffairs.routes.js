const express = require('express');
const { requireAuth } = require('../middleware/auth');
const hac = require('../controllers/homeAffairs.controller');

const router = express.Router();
router.use(requireAuth);

// Birth registration
router.post('/birth-registration', hac.createBirthRegistration);
router.get('/birth-registration', hac.listBirthRegistrations);
router.get('/birth-registration/:id', hac.getBirthRegistration);
router.post('/birth-registration/:id/start-review', hac.startReviewBirthRegistration);
router.post('/birth-registration/:id/request-information', hac.requestInformationBirthRegistration);
router.post('/birth-registration/:id/resubmit', hac.resubmitBirthRegistration);
router.post('/birth-registration/:id/verify', hac.verifyBirthRegistration);
router.post('/birth-registration/:id/confirm-verification', hac.confirmVerificationBirthRegistration);
router.post('/birth-registration/:id/approve', hac.approveBirthRegistration);
router.post('/birth-registration/:id/reject', hac.rejectBirthRegistration);

// Birth certificate
router.get('/birth-certificate/:id', hac.getBirthCertificate);
router.post('/birth-certificate/:id/ready-for-collection', hac.markCertificateReadyForCollection);
router.post('/birth-certificate/:id/collect', hac.collectBirthCertificate);

// National ID card
router.post('/national-id/apply', hac.applyNationalId);
router.get('/national-id', hac.listNationalId);
router.get('/national-id/:id', hac.getNationalId);
router.post('/national-id/:id/:action', hac.transitionNationalId);

// Corrections (FR12)
router.post('/correction', hac.submitCorrection);
router.get('/correction', hac.listCorrections);
router.post('/correction/:id/decide', hac.decideCorrection);

// Death registration
router.post('/death-registration', hac.reportDeath);
router.get('/death-registration', hac.listDeathRegistrations);
router.get('/death-registration/:id', hac.getDeathRegistration);
router.post('/death-registration/:id/approve', hac.approveDeath);

// Marriage registration
router.post('/marriage-registration', hac.createMarriageRegistration);
router.get('/marriage-registration', hac.listMarriageRegistrations);
router.get('/marriage-registration/:id', hac.getMarriageRegistration);
router.post('/marriage-registration/:id/start-review', hac.startReviewMarriage);
router.post('/marriage-registration/:id/request-information', hac.requestInformationMarriage);
router.post('/marriage-registration/:id/resubmit', hac.resubmitMarriage);
router.post('/marriage-registration/:id/verify', hac.verifyMarriage);
router.post('/marriage-registration/:id/approve', hac.approveMarriage);
router.post('/marriage-registration/:id/reject', hac.rejectMarriage);
router.get('/marriage-certificate/:id', hac.getMarriageCertificate);

// Divorce registration
router.post('/divorce-registration', hac.createDivorceRegistration);
router.get('/divorce-registration', hac.listDivorceRegistrations);
router.get('/divorce-registration/:id', hac.getDivorceRegistration);
router.post('/divorce-registration/:id/start-review', hac.startReviewDivorce);
router.post('/divorce-registration/:id/request-information', hac.requestInformationDivorce);
router.post('/divorce-registration/:id/resubmit', hac.resubmitDivorce);
router.post('/divorce-registration/:id/verify', hac.verifyDivorce);
router.post('/divorce-registration/:id/approve', hac.approveDivorce);
router.post('/divorce-registration/:id/reject', hac.rejectDivorce);
router.get('/divorce-certificate/:id', hac.getDivorceCertificate);

module.exports = router;
