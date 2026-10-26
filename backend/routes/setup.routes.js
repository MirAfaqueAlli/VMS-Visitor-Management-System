// backend/routes/setup.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/setup.controller');
const { validate } = require('../middlewares/validate.middleware');
const { authLimiter } = require('../middlewares/rateLimit.middleware');
const {
  setupInitSchema,
  setupSendEmailOtpSchema,
  setupVerifyEmailOtpSchema,
  setupSendPhoneOtpSchema,
  setupVerifyPhoneSchema,
} = require('../validators/schemas');

// Every code sent counts; only wrong codes count towards the verify limit
const sendCodeLimiter = authLimiter(10, 'Too many verification codes requested. Please try again in 15 minutes.', true);
const verifyLimiter   = authLimiter(30, 'Too many incorrect codes from this network. Please try again in 15 minutes.');

// GET  /api/setup/status — returns { initialized: bool }
router.get('/status', ctrl.getStatus);

// The super admin's email and mobile are verified by OTP first (setup-only:
// these refuse with 409 once the system is initialized)
router.post('/send-email-otp',   sendCodeLimiter, validate(setupSendEmailOtpSchema),   ctrl.sendEmailOtp);
router.post('/verify-email-otp', verifyLimiter,   validate(setupVerifyEmailOtpSchema), ctrl.verifyEmailOtp);
router.post('/send-phone-otp',   sendCodeLimiter, validate(setupSendPhoneOtpSchema),   ctrl.sendPhoneOtp);   // development only
router.post('/verify-phone',     verifyLimiter,   validate(setupVerifyPhoneSchema),    ctrl.verifyPhone);

// POST /api/setup — one-time init: creates org + super admin
// Only works when system is completely empty (no org, no users), and needs the
// email_token / phone_token proofs from the routes above
router.post('/', validate(setupInitSchema), ctrl.initialize);

module.exports = router;
