// backend/controllers/otp.controller.js
'use strict';

const { sendSuccess, sendError } = require('../utils/response.util');
const otpService = require('../services/otp.service');

/**
 * POST /api/otp/send
 * Body: { phone, purpose }
 * Uses req.db (unit pool set by protect/optionalProtect middleware).
 */
const sendOtp = async (req, res) => {
  try {
    const { phone, purpose } = req.body;

    if (!phone || phone.length < 10) return sendError(res, 'Valid phone number is required.', 400);
    if (!purpose) return sendError(res, 'purpose is required.', 400);

    const VALID_PURPOSES = ['VISITOR_VERIFY', 'LOGIN_2FA', 'RESET_PASSWORD'];
    if (!VALID_PURPOSES.includes(purpose)) return sendError(res, `Invalid purpose. Must be one of: ${VALID_PURPOSES.join(', ')}`, 400);

    if (!req.db) return sendError(res, 'Cannot resolve unit database. Provide a valid token or unit_code.', 400);

    const userId = req.user?.id || null;
    const result = await otpService.sendOtp(req.db, phone, purpose, userId);
    return sendSuccess(res, result, result.message, 200);
  } catch (err) {
    console.error('[OtpController] sendOtp error:', err.message);
    return sendError(res, 'Failed to send OTP.', 500);
  }
};

/**
 * POST /api/otp/verify
 * Body: { phone, otp, purpose }
 * On VISITOR_VERIFY: marks is_mobile_verified = TRUE for the visitor.
 */
const verifyOtp = async (req, res) => {
  try {
    const { phone, otp, purpose } = req.body;
    if (!phone || !otp || !purpose) return sendError(res, 'phone, otp, and purpose are required.', 400);
    if (!req.db) return sendError(res, 'Cannot resolve unit database.', 400);

    const result = await otpService.verifyOtp(req.db, phone, otp, purpose);
    if (!result.valid) return sendError(res, result.message, 400);

    // If verifying a visitor's mobile, mark them verified in the unit DB
    if (purpose === 'VISITOR_VERIFY') {
      await req.db.query(
        'UPDATE visitors SET is_mobile_verified = TRUE WHERE phone = ?',
        [phone]
      );
    }

    return sendSuccess(res, { verified: true }, result.message, 200);
  } catch (err) {
    console.error('[OtpController] verifyOtp error:', err.message);
    return sendError(res, 'Failed to verify OTP.', 500);
  }
};

module.exports = { sendOtp, verifyOtp };
