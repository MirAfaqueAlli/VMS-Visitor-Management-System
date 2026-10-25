// backend/routes/publicAuth.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/publicAuth.controller');
const { validate } = require('../middlewares/validate.middleware');
const { z } = require('zod');
const {
  publicSendPhoneOtpSchema,
  publicSendEmailOtpSchema,
  publicVerifyEmailOtpSchema,
} = require('../validators/schemas');

// Inline schema for Firebase phone token verification
const verifyFirebasePhoneSchema = z.object({
  phone:   z.string().min(10, 'A valid phone number is required.'),
  idToken: z.string().min(1,  'Firebase idToken is required.'),
});

// All public — no authentication middleware required
router.post('/send-phone-otp',         validate(publicSendPhoneOtpSchema),      ctrl.sendPhoneOtp);
router.post('/verify-firebase-phone',  validate(verifyFirebasePhoneSchema),      ctrl.verifyFirebasePhone);
router.post('/send-email-otp',         validate(publicSendEmailOtpSchema),       ctrl.sendEmailOtp);
router.post('/verify-email-otp',       validate(publicVerifyEmailOtpSchema),     ctrl.verifyEmailOtp);

module.exports = router;
