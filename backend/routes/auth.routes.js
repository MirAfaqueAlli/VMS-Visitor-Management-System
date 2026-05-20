// backend/routes/auth.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const { z }   = require('zod');

const authController         = require('../controllers/auth.controller');
const { protect }            = require('../middlewares/auth.middleware');
const { validate }           = require('../middlewares/validate.middleware');

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

/**
 * Schema for POST /login
 * Both fields are required non-empty strings.
 */
const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required.' })
    .trim()
    .email('Please provide a valid email address.'),
  password: z
    .string({ required_error: 'Password is required.' })
    .min(1, 'Password cannot be empty.'),
});

/**
 * Schema for PUT /change-password
 * currentPassword must be provided; newPassword must be at least 8 characters.
 */
const changePasswordSchema = z.object({
  currentPassword: z
    .string({ required_error: 'Current password is required.' })
    .min(1, 'Current password cannot be empty.'),
  newPassword: z
    .string({ required_error: 'New password is required.' })
    .min(8, 'New password must be at least 8 characters long.'),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /api/auth/login — authenticate and receive a JWT
router.post('/login', validate(loginSchema), authController.login);

// POST /api/auth/register-org — public: register a new organization + org_admin
router.post('/register-org', authController.registerOrg);

// GET /api/auth/me — return the authenticated user's profile
router.get('/me', protect, authController.getMe);

// PUT /api/auth/change-password — update the authenticated user's password
router.put('/change-password', protect, validate(changePasswordSchema), authController.changePassword);

module.exports = router;
