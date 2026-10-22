const express = require('express');
const { verifyIdentity } = require('../controllers/identity.controller');

const router = express.Router();
// Unauthenticated — used during account registration before a token exists.
router.post('/verify', verifyIdentity);

// The manual "Identity Verification" review requests (/requests, /requests/:id/verify,
// /requests/:id/reject) have been removed — see identity.controller.js for why. The
// identity_verification_requests table and any request already in it are untouched; this
// router simply no longer has routes that create or act on new ones.

module.exports = router;
