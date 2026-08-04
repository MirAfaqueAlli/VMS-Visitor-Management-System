// backend/routes/auth.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const { z }   = require('zod');

const authController = require('../controllers/auth.controller');
const { protect }    = require('../middlewares/auth.middleware');
const { validate }   = require('../middlewares/validate.middleware');

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

router.post('/login',             validate(loginSchema),             authController.login);
router.post('/verify-login-otp',  validate(verifyLoginOtpSchema),    authController.verifyLoginOtp);
router.get ('/me',                protect,                           authController.getMe);
router.post('/refresh',           protect,                           authController.refresh);
router.put ('/change-password',   protect, validate(changePasswordSchema), authController.changePassword);

module.exports = router;
