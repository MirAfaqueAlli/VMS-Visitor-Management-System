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

// Email OTP verification schema (allows standalone email verification as well as full registration)
const verifyEmailOtpBaseSchema = z.object({
  email: z.string().email('A valid email address is required.'),
  otp:   z.string().regex(/^\d{6}$/, 'OTP must be exactly 6 digits.'),
}).passthrough();

// All public — no authentication middleware required
router.post('/check-phone',               ctrl.checkPhone);
router.post('/check-email',               ctrl.checkEmail);
router.post('/send-phone-otp',            validate(publicSendPhoneOtpSchema),    ctrl.sendPhoneOtp);
router.post('/verify-firebase-phone',     validate(verifyFirebasePhoneSchema),   ctrl.verifyFirebasePhone);
router.post('/existing-visitor-verify',   validate(verifyFirebasePhoneSchema),   ctrl.existingVisitorVerify);
router.post('/send-email-otp',            validate(publicSendEmailOtpSchema),    ctrl.sendEmailOtp);
router.post('/verify-email-otp',          validate(verifyEmailOtpBaseSchema),    ctrl.verifyEmailOtp);

// Email + Password Auth & Account Management
router.post('/login',                     ctrl.login);
router.post('/register-with-password',    ctrl.registerWithPassword);
router.post('/forgot-password/init',      ctrl.forgotPasswordInit);
router.post('/forgot-password/reset',     ctrl.forgotPasswordReset);

// Visitor Portal Authenticated Endpoints (uses X-Visitor-Token or Authorization Bearer)
router.get('/me',                         ctrl.getVisitorProfile);
router.put('/profile',                    ctrl.updateVisitorProfile);
router.get('/my-requests',                ctrl.getMyVisitorRequests);
router.post('/cancel-request',            ctrl.cancelMyVisitorRequest);
router.get('/pass/:unitId/:passNumber',   ctrl.getVisitorPass);

module.exports = router;
