// backend/routes/auth.routes.js
'use strict';

const express   = require('express');
const router    = express.Router();
const { z }     = require('zod');
const rateLimit = require('express-rate-limit');

const authController = require('../controllers/auth.controller');
const { protect }    = require('../middlewares/auth.middleware');
const { validate }   = require('../middlewares/validate.middleware');

// ── Per-IP brute-force limits (per-account lockout is in auth.controller) ─────
// Relaxed outside production, like the global limiter in server.js.
const isProd = process.env.NODE_ENV === 'production';
const authLimiter = (limit, message, countSuccessful = false) => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isProd ? limit : limit * 10,
  skipSuccessfulRequests: !countSuccessful,   // usually only failed attempts count
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message },
});

const loginLimiter  = authLimiter(20, 'Too many failed sign-in attempts from this network. Please try again in 15 minutes.');
const otpLimiter    = authLimiter(30, 'Too many incorrect codes from this network. Please try again in 15 minutes.');
// forgot-password always answers 200 (no account enumeration), so count every request
const forgotLimiter = authLimiter(10, 'Too many password reset requests. Please try again in 15 minutes.', true);
const resetLimiter  = authLimiter(10, 'Too many password reset attempts. Please try again in 15 minutes.');

const loginSchema = z.object({
  email: z.string({ required_error: 'Email is required.' }).trim().email('Please provide a valid email address.'),
  password: z.string({ required_error: 'Password is required.' }).min(1, 'Password cannot be empty.'),
  unit_code: z.string().trim().optional(),
  unit_id: z.any().optional(),
});

const verifyLoginOtpSchema = z.object({
  loginToken: z.string({ required_error: 'Login token is required.' }).min(1),
  otp: z.string({ required_error: 'OTP is required.' }).regex(/^\d{6}$/, 'OTP must be exactly 6 digits.'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string({ required_error: 'Current password is required.' }).min(1),
  newPassword: z.string({ required_error: 'New password is required.' }).min(8, 'New password must be at least 8 characters long.'),
});

const forgotPasswordSchema = z.object({
  email:   z.string({ error: 'Email is required.' }).trim().email('Please provide a valid email address.'),
  unit_id: z.any().optional(),
});

const resetPasswordSchema = z.object({
  token:       z.string({ error: 'Reset link is invalid.' }).regex(/^[a-f0-9]{64}$/, 'Reset link is invalid.'),
  newPassword: z.string({ error: 'New password is required.' }).min(8, 'New password must be at least 8 characters long.'),
});

router.post('/login',             loginLimiter, validate(loginSchema),          authController.login);
router.post('/verify-login-otp',  otpLimiter,   validate(verifyLoginOtpSchema), authController.verifyLoginOtp);
router.get ('/me',                protect,                           authController.getMe);
router.post('/refresh',           protect,                           authController.refresh);
router.put ('/change-password',   protect, validate(changePasswordSchema), authController.changePassword);

// Password recovery (public)
router.post('/forgot-password',   forgotLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password',    resetLimiter,  validate(resetPasswordSchema),  authController.resetPassword);

module.exports = router;
