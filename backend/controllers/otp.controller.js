// backend/controllers/otp.controller.js
'use strict';

const pool = require('../db');
const { sendSuccess, sendError } = require('../utils/response.util');
const otpService = require('../services/otp.service');

const sendOtp = async (req, res) => {
  try {
    const { phone, purpose } = req.body;
    if (!phone || phone.length !== 10) return sendError(res, 'Valid 10-digit phone number is required.', 400);
    if (purpose !== 'VISITOR_VERIFY') return sendError(res, 'Invalid purpose.', 400);

    const result = await otpService.sendOtp(phone, purpose);
    return sendSuccess(res, result, result.message, 200);
  } catch (err) {
    console.error('[OtpController] sendOtp error:', err.message);
    return sendError(res, 'Failed to send OTP.', 500);
  }
};

const verifyOtp = async (req, res) => {
  try {
    const { phone, otp, purpose } = req.body;
    if (!phone || !otp || !purpose) return sendError(res, 'Phone, otp, and purpose are required.', 400);

    const result = await otpService.verifyOtp(phone, otp, purpose);
    if (!result.valid) {
      return sendError(res, result.message, 400);
    }

    // If it's for visitor verification, update the visitor record if exists
    if (purpose === 'VISITOR_VERIFY') {
      await pool.query(`UPDATE visitors SET is_mobile_verified = TRUE WHERE phone = ?`, [phone]);
    }

    return sendSuccess(res, { verified: true }, result.message, 200);
  } catch (err) {
    console.error('[OtpController] verifyOtp error:', err.message);
    return sendError(res, 'Failed to verify OTP.', 500);
  }
};

module.exports = { sendOtp, verifyOtp };
