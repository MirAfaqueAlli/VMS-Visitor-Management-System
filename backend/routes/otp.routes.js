// backend/routes/otp.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/otp.controller');
const { optionalProtect } = require('../middlewares/auth.middleware');
const { z }         = require('zod');
const { sendError } = require('../utils/response.util');

const sendOtpSchema = z.object({
  phone:   z.string().min(10, 'Phone must be at least 10 digits'),
  purpose: z.string(),
});

const verifyOtpSchema = z.object({
  phone:   z.string().min(10, 'Phone must be at least 10 digits'),
  otp:     z.string().length(6, 'OTP must be 6 digits'),
  purpose: z.string(),
});

const validateSend   = (req, res, next) => {
  try { req.body = sendOtpSchema.parse(req.body); next(); }
  catch (err) { return sendError(res, 'Validation error', 400, err.errors); }
};

const validateVerify = (req, res, next) => {
  try { req.body = verifyOtpSchema.parse(req.body); next(); }
  catch (err) { return sendError(res, 'Validation error', 400, err.errors); }
};

// optionalProtect sets req.db from token if present, otherwise req.db is null
// The controller will validate that req.db is set before proceeding
router.post('/send',   optionalProtect, validateSend,   ctrl.sendOtp);
router.post('/verify', optionalProtect, validateVerify, ctrl.verifyOtp);

module.exports = router;
