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
  unit_code: z.string().trim().optional(), // required for non-super-admin users
  unit_id: z.any().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string({ required_error: 'Current password is required.' }).min(1),
  newPassword: z.string({ required_error: 'New password is required.' }).min(8, 'New password must be at least 8 characters long.'),
});

router.post('/login',          validate(loginSchema),          authController.login);
router.get('/me',              protect,                        authController.getMe);
router.put('/change-password', protect, validate(changePasswordSchema), authController.changePassword);

module.exports = router;
