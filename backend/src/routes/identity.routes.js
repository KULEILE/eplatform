const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  verifyIdentity, submitIdentityRequest, listIdentityRequests, verifyIdentityRequest, rejectIdentityRequest,
} = require('../controllers/identity.controller');

const router = express.Router();
// Unauthenticated — used during account registration before a token exists.
router.post('/verify', verifyIdentity);

// Identity verification requests — the manual Home Affairs review path for provisional
// accounts. All require an authenticated session.
router.post('/requests', requireAuth, submitIdentityRequest);
router.get('/requests', requireAuth, listIdentityRequests);
router.post('/requests/:id/verify', requireAuth, verifyIdentityRequest);
router.post('/requests/:id/reject', requireAuth, rejectIdentityRequest);

module.exports = router;
