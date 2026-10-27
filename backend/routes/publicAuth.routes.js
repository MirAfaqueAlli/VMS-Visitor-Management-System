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

// Firebase phone token verification (development: a logged code instead of the idToken)
const verifyFirebasePhoneSchema = z.object({
  phone:   z.string().min(10, 'A valid phone number is required.'),
  idToken: z.string().min(1).optional(),
  otp:     z.string().regex(/^\d{6}$/, 'OTP must be exactly 6 digits.').optional(),
}).refine((d) => d.idToken || d.otp, { message: 'Firebase idToken is required.' });

// All public — no authentication middleware required
router.post('/check-phone',               ctrl.checkPhone);
router.post('/send-phone-otp',            validate(publicSendPhoneOtpSchema),    ctrl.sendPhoneOtp);
router.post('/verify-firebase-phone',     validate(verifyFirebasePhoneSchema),   ctrl.verifyFirebasePhone);
router.post('/existing-visitor-verify',   validate(verifyFirebasePhoneSchema),   ctrl.existingVisitorVerify);
router.post('/send-email-otp',            validate(publicSendEmailOtpSchema),    ctrl.sendEmailOtp);
router.post('/verify-email-otp',          validate(publicVerifyEmailOtpSchema),  ctrl.verifyEmailOtp);

module.exports = router;
