// backend/routes/otp.routes.js
'use strict';

const express = require('express');
const router = express.Router();
const otpController = require('../controllers/otp.controller');
const { z } = require('zod');
const { sendError } = require('../utils/response.util');

const sendOtpSchema = z.object({
  phone: z.string().regex(/^\d{10}$/, 'Phone must be 10 digits'),
  purpose: z.string()
});

const verifyOtpSchema = z.object({
  phone: z.string().regex(/^\d{10}$/, 'Phone must be 10 digits'),
  otp: z.string().length(6, 'OTP must be 6 digits'),
  purpose: z.string()
});

const validateSend = (req, res, next) => {
  try {
    req.body = sendOtpSchema.parse(req.body);
    next();
  } catch (err) {
    return sendError(res, 'Validation error', 400, err.errors);
  }
};

const validateVerify = (req, res, next) => {
  try {
    req.body = verifyOtpSchema.parse(req.body);
    next();
  } catch (err) {
    return sendError(res, 'Validation error', 400, err.errors);
  }
};

router.post('/send', validateSend, otpController.sendOtp);
router.post('/verify', validateVerify, otpController.verifyOtp);

module.exports = router;
