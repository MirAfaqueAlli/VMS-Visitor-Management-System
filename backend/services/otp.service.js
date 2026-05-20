// backend/services/otp.service.js
'use strict';

const pool = require('../db');
const bcrypt = require('bcrypt');

/**
 * Generates a 6-digit OTP, invalidates old ones, saves to DB, and sends via Fast2SMS.
 *
 * @param {string} mobileNumber - 10-digit mobile number
 * @param {string} purpose - e.g. 'VISITOR_VERIFY'
 * @param {number|null} visitorId
 * @param {number|null} userId
 * @returns {Promise<{ success: boolean, message: string }>}
 */
const sendOtp = async (mobileNumber, purpose, visitorId = null, userId = null) => {
  try {
    const otpCode = String(Math.floor(100000 + Math.random() * 900000));
    const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES, 10) || 10;
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    const hashedOtp = await bcrypt.hash(otpCode, 10);

    // Invalidate existing unused OTPs for same number + purpose
    await pool.query(
      `UPDATE otp_logs
          SET is_used = TRUE
        WHERE mobile_number = ? AND purpose = ? AND is_used = FALSE`,
      [mobileNumber, purpose]
    );

    // Insert new OTP row
    await pool.query(
      `INSERT INTO otp_logs
          (visitor_id, user_id, mobile_number, otp_code, purpose, is_used, expires_at)
       VALUES (?, ?, ?, ?, ?, FALSE, ?)`,
      [visitorId, userId, mobileNumber, hashedOtp, purpose, expiresAt]
    );

    // Send via Fast2SMS
    const apiKey = process.env.FAST2SMS_API_KEY;
    if (!apiKey) {
      console.warn(`[OTPService] FAST2SMS_API_KEY not set. Skipping SMS delivery. OTP (${otpCode}) saved to DB (hashed).`);
      return { success: true, message: 'OTP generated (SMS not sent — no API key configured)' };
    }

    const body = new URLSearchParams({
      route: 'otp',
      variables_values: otpCode,
      numbers: mobileNumber,
      flash: '0',
    });

    const smsRes = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const smsData = await smsRes.json().catch(() => ({}));

    if (!smsRes.ok || smsData.return === false) {
      console.error('[OTPService] Fast2SMS delivery failed:', smsData);
      // Still return success — OTP is in DB (useful for dev/testing)
      return { success: true, message: 'OTP generated but SMS delivery failed. Check Fast2SMS balance/config.' };
    }

    return { success: true, message: 'OTP sent successfully' };
  } catch (err) {
    console.error('[OTPService] sendOtp error:', err.message);
    throw err;
  }
};

/**
 * Verifies an OTP from DB and marks it as used.
 *
 * @param {string} mobileNumber
 * @param {string} otp
 * @param {string} purpose
 * @returns {Promise<{ valid: boolean, message: string }>}
 */
const verifyOtp = async (mobileNumber, otp, purpose) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM otp_logs
        WHERE mobile_number = ?
          AND purpose = ?
          AND is_used = FALSE
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1`,
      [mobileNumber, purpose]
    );

    if (rows.length === 0) {
      return { valid: false, message: 'Invalid or expired OTP' };
    }

    const logRow = rows[0];
    const isMatch = await bcrypt.compare(otp, logRow.otp_code);

    if (!isMatch) {
      return { valid: false, message: 'Invalid or expired OTP' };
    }

    await pool.query(
      `UPDATE otp_logs SET is_used = TRUE WHERE id = ?`,
      [logRow.id]
    );

    return { valid: true, message: 'OTP verified successfully' };
  } catch (err) {
    console.error('[OTPService] verifyOtp error:', err.message);
    throw err;
  }
};

module.exports = { sendOtp, verifyOtp };
