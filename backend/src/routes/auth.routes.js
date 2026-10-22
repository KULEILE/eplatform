const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  register, login, logout, me, changePassword,
  forgotPasswordStart, forgotPasswordVerify, forgotPasswordReset,
} = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
// Forgot-password is a 3-step guessing surface (username, then two security answers) — its own,
// stricter limiter so someone can't use it to brute-force a username/answer combination.
const forgotPasswordLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

router.post('/register', loginLimiter, register);
router.post('/login', loginLimiter, login);
router.post('/logout', requireAuth, logout);
router.get('/me', requireAuth, me);
router.post('/change-password', requireAuth, changePassword);

router.post('/forgot-password/start', forgotPasswordLimiter, forgotPasswordStart);
router.post('/forgot-password/verify', forgotPasswordLimiter, forgotPasswordVerify);
router.post('/forgot-password/reset', forgotPasswordLimiter, forgotPasswordReset);

module.exports = router;
