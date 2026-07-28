// backend/routes/publicAuth.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/publicAuth.controller');
const { validate } = require('../middlewares/validate.middleware');
const {
  publicSendPhoneOtpSchema,
  publicVerifyPhoneOtpSchema,
  publicSendEmailOtpSchema,
  publicVerifyEmailOtpSchema,
} = require('../validators/schemas');

// All public — no authentication middleware required
router.post('/send-phone-otp',   validate(publicSendPhoneOtpSchema),   ctrl.sendPhoneOtp);
router.post('/verify-phone-otp', validate(publicVerifyPhoneOtpSchema), ctrl.verifyPhoneOtp);
router.post('/send-email-otp',   validate(publicSendEmailOtpSchema),   ctrl.sendEmailOtp);
router.post('/verify-email-otp', validate(publicVerifyEmailOtpSchema), ctrl.verifyEmailOtp);

module.exports = router;
