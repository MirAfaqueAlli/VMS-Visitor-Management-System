// backend/routes/visitorPortal.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/visitorPortal.controller');
const { validate } = require('../middlewares/validate.middleware');
const { authLimiter } = require('../middlewares/rateLimit.middleware');
const { uploadVisitorPhoto } = require('../middlewares/upload.middleware');
const { sendError } = require('../utils/response.util');
const { z } = require('zod');

// Per-IP limits. /identify counts every request: it tells whether a number or
// email has an account, so it must not be usable to sweep through numbers.
const identifyLimiter = authLimiter(30, 'Too many account checks from this network. Please try again in 15 minutes.', true);
const loginLimiter    = authLimiter(20, 'Too many failed sign-in attempts from this network. Please try again in 15 minutes.');
const otpLimiter      = authLimiter(30, 'Too many incorrect codes from this network. Please try again in 15 minutes.');
const sendLimiter     = authLimiter(10, 'Too many codes requested. Please try again in 15 minutes.', true);
const checkLimiter    = authLimiter(60, 'Too many account checks from this network. Please try again in 15 minutes.', true);

const phoneOtpSchema = z.object({
  phone:   z.string().min(10, 'A valid phone number is required.'),
  idToken: z.string().min(1).optional(),
  otp:     z.string().regex(/^\d{6}$/, 'OTP must be exactly 6 digits.').optional(),
}).refine((d) => d.idToken || d.otp, { message: 'The OTP is required.' });

const codeOnlySchema = z.object({
  idToken: z.string().min(1).optional(),
  otp:     z.string().regex(/^\d{6}$/, 'OTP must be exactly 6 digits.').optional(),
}).refine((d) => d.idToken || d.otp, { message: 'The OTP is required.' });

const identifySchema = z.object({ identifier: z.string().trim().min(3, 'Enter your mobile number or email.').max(120) });
const checkSchema    = z.object({ phone: z.string().max(20).optional(), email: z.string().trim().max(100).optional() });
const loginSchema    = z.object({ identifier: z.string().trim().min(3).max(120), password: z.string().min(1).max(200) });
const registerSchema = z.object({
  full_name:   z.string().trim().min(2).max(100),
  phone:       z.string().min(10).max(20),
  email:       z.string().trim().email().max(100),
  address:     z.string().trim().min(5).max(255),
  password:    z.string().min(8).max(200),
  phone_token: z.string().min(1),
  email_otp:   z.string().regex(/^\d{6}$/, 'The email code must be 6 digits.'),
});
const profileSchema  = z.object({ full_name: z.string().trim().min(2).max(100), address: z.string().trim().max(255).optional() });
const emailSchema    = z.object({ email: z.string().trim().email().max(100) });
const emailOtpSchema = z.object({ email: z.string().trim().email().max(100), otp: z.string().regex(/^\d{6}$/) });
const passwordSchema = z.object({ current_password: z.string().max(200).optional(), new_password: z.string().min(8).max(200) });

// ── Public ────────────────────────────────────────────────────────────────────
router.post('/identify',  identifyLimiter, validate(identifySchema), ctrl.identify);
router.post('/login',     loginLimiter,    validate(loginSchema),    ctrl.login);
router.post('/login/otp', otpLimiter,      validate(phoneOtpSchema), ctrl.loginWithOtp);
router.post('/register/check', checkLimiter, validate(checkSchema), ctrl.checkRegistration);
router.post('/register',  otpLimiter,      validate(registerSchema), ctrl.register);

// ── Signed-in visitor (X-Visitor-Session) ────────────────────────────────────
router.use('/me', ctrl.requireVisitorSession);
router.get('/me',                           ctrl.me);
router.put('/me',                           validate(profileSchema),  ctrl.updateMe);
router.post('/me/email/send',  sendLimiter, validate(emailSchema),    ctrl.sendEmailVerification);
router.post('/me/email/verify', otpLimiter, validate(emailOtpSchema), ctrl.verifyEmail);
router.post('/me/phone/verify', otpLimiter, validate(codeOnlySchema), ctrl.verifyPhone);
router.post('/me/password',     loginLimiter, validate(passwordSchema), ctrl.setPassword);
router.put('/me/id-proof',                 ctrl.setIdProof);
router.post('/me/photo', (req, res, next) => uploadVisitorPhoto(req, res, (err) => (err ? sendError(res, err.message, 400) : next())), ctrl.setPhoto);
router.delete('/me/photo',                 ctrl.removePhoto);
router.get('/me/visits',                    ctrl.myVisits);
router.get('/me/visits/:unitId/:id/pass',   ctrl.myPass);
router.post('/me/visits/:unitId/:id/cancel', ctrl.cancelVisit);
router.post('/me/visitor-token',            ctrl.visitorToken);

module.exports = router;
