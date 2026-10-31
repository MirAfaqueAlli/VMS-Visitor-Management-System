// backend/routes/publicAuth.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/publicAuth.controller');
const { validate } = require('../middlewares/validate.middleware');
const { authLimiter } = require('../middlewares/rateLimit.middleware');
const { z } = require('zod');
const {
  publicSendPhoneOtpSchema,
  publicSendEmailOtpSchema,
} = require('../validators/schemas');

// Firebase phone token verification (development: a logged code instead of the idToken)
const verifyFirebasePhoneSchema = z.object({
  phone:   z.string().min(10, 'A valid phone number is required.'),
  idToken: z.string().min(1).optional(),
  otp:     z.string().regex(/^\d{6}$/, 'OTP must be exactly 6 digits.').optional(),
}).refine((d) => d.idToken || d.otp, { message: 'Firebase idToken is required.' });

// Per-IP limits: sending codes costs SMS/email; verifying is a guessing target
const sendLimiter   = authLimiter(20, 'Too many codes requested from this network. Please try again in 15 minutes.', true);
const verifyLimiter = authLimiter(30, 'Too many incorrect codes from this network. Please try again in 15 minutes.');

// Public — used by the visitor portal's registration. Sign-in, accounts, visits
// and passes live under /api/visitor-portal (visitorPortal.routes.js).
router.post('/send-phone-otp',        sendLimiter,   validate(publicSendPhoneOtpSchema),  ctrl.sendPhoneOtp);
router.post('/verify-firebase-phone', verifyLimiter, validate(verifyFirebasePhoneSchema), ctrl.verifyFirebasePhone);
router.post('/send-email-otp',        sendLimiter,   validate(publicSendEmailOtpSchema),  ctrl.sendEmailOtp);

module.exports = router;
