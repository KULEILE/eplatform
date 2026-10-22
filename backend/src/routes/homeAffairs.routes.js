const express = require('express');
const { requireAuth } = require('../middleware/auth');
const hac = require('../controllers/homeAffairs.controller');
const hac2 = require('../controllers/homeAffairsServices2.controller');
const nat = require('../controllers/naturalization.controller');

const router = express.Router();
router.use(requireAuth);

// National ID — renewal & replacement (new service; reuses the national-id table/pipeline)
router.post('/national-id/renew-replace', hac.applyNationalIdRenewalReplacement);

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

// Corrections (FR12) moved to /api/corrections — see corrections.routes.js

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

// Birth certificate reissue (new service)
router.post('/birth-certificate-reissue', hac2.requestBirthCertificateReissue);
router.get('/birth-certificate-reissue', hac2.listBirthCertificateReissues);
router.get('/birth-certificate-reissue/:id', hac2.getBirthCertificateReissue);
router.post('/birth-certificate-reissue/:id/start-review', hac2.startReviewReissue);
router.post('/birth-certificate-reissue/:id/request-information', hac2.requestInformationReissue);
router.post('/birth-certificate-reissue/:id/resubmit', hac2.resubmitReissue);
router.post('/birth-certificate-reissue/:id/approve', hac2.approveReissue);
router.post('/birth-certificate-reissue/:id/reject', hac2.rejectReissue);

// Death certificate issuance — REMOVED. The certificate is now generated automatically when a
// death registration is approved (see /death-registration/:id/approve above and migration 058).

// Change/alteration of name or surname (new service)
router.post('/name-change', hac2.requestNameChange);
router.get('/name-change', hac2.listNameChangeRequests);
router.get('/name-change/:id', hac2.getNameChangeRequest);
router.post('/name-change/:id/start-review', hac2.startReviewNameChange);
router.post('/name-change/:id/request-information', hac2.requestInformationNameChange);
router.post('/name-change/:id/resubmit', hac2.resubmitNameChange);
router.post('/name-change/:id/approve', hac2.approveNameChange);
router.post('/name-change/:id/reject', hac2.rejectNameChange);

// Adoption registration (new service)
router.post('/adoption', hac2.requestAdoption);
router.get('/adoption', hac2.listAdoptions);
router.get('/adoption/:id', hac2.getAdoption);
router.post('/adoption/:id/start-review', hac2.startReviewAdoption);
router.post('/adoption/:id/request-information', hac2.requestInformationAdoption);
router.post('/adoption/:id/resubmit', hac2.resubmitAdoption);
router.post('/adoption/:id/approve', hac2.approveAdoption);
router.post('/adoption/:id/reject', hac2.rejectAdoption);

// Civil marriage solemnisation booking (new service)
router.post('/marriage-solemnisation', hac2.requestSolemnisationBooking);
router.get('/marriage-solemnisation', hac2.listSolemnisationBookings);
router.get('/marriage-solemnisation/:id', hac2.getSolemnisationBooking);
router.post('/marriage-solemnisation/:id/request-information', hac2.requestInformationSolemnisation);
router.post('/marriage-solemnisation/:id/resubmit', hac2.resubmitSolemnisation);
router.post('/marriage-solemnisation/:id/confirm', hac2.confirmSolemnisation);
router.post('/marriage-solemnisation/:id/complete', hac2.completeSolemnisation);
router.post('/marriage-solemnisation/:id/cancel', hac2.cancelSolemnisation);
router.post('/marriage-solemnisation/:id/reject', hac2.rejectSolemnisation);

// Registration of marriage officers (new service — internal registry, officer/admin only)
router.post('/marriage-officers', hac2.createMarriageOfficer);
router.get('/marriage-officers', hac2.listMarriageOfficers);
router.get('/marriage-officers/:id', hac2.getMarriageOfficer);
router.post('/marriage-officers/:id/status', hac2.updateMarriageOfficerStatus);

// Citizenship by naturalization (new service — foreign-national accounts only; see migration 051)
router.post('/naturalization', nat.submitNaturalizationRequest);
router.get('/naturalization', nat.listNaturalizationRequests);
router.get('/naturalization/:id', nat.getNaturalizationRequest);
router.post('/naturalization/:id/start-review', nat.startReviewNaturalization);
router.post('/naturalization/:id/request-information', nat.requestInformationNaturalization);
router.post('/naturalization/:id/resubmit', nat.resubmitNaturalization);
router.post('/naturalization/:id/approve', nat.approveNaturalization);
router.post('/naturalization/:id/reject', nat.rejectNaturalization);

// Identity enrolment for non-citizens/refugees (new service)
router.post('/foreign-identity', hac2.applyForeignIdentity);
router.get('/foreign-identity', hac2.listForeignIdentityEnrolments);
router.get('/foreign-identity/:id', hac2.getForeignIdentityEnrolment);
router.post('/foreign-identity/:id/start-review', hac2.startReviewForeignIdentity);
router.post('/foreign-identity/:id/request-information', hac2.requestInformationForeignIdentity);
router.post('/foreign-identity/:id/resubmit', hac2.resubmitForeignIdentity);
router.post('/foreign-identity/:id/approve', hac2.approveForeignIdentity);
router.post('/foreign-identity/:id/reject', hac2.rejectForeignIdentity);

module.exports = router;
