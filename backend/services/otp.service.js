// backend/services/otp.service.js
'use strict';

/**
 * OTP Service — unit-DB aware.
 * All functions accept a `db` parameter (the unit pool from req.db).
 * otp_logs lives in the unit DB (per vms_unit_schema.sql).
 *
 * @param {object} db - mysql2/promise pool (req.db)
 */

/**
 * Generates a 6-digit OTP, invalidates old ones for the same mobile+purpose,
 * saves the hashed OTP to otp_logs, and attempts Fast2SMS delivery.
 *
 * @param {object} db
 * @param {string} mobileNumber
 * @param {string} purpose
 * @param {number|null} userId
 * @returns {Promise<{ success: boolean, message: string }>}
 */
const sendOtp = async (db, mobileNumber, purpose, userId = null) => {
  try {
    const otpCode       = String(Math.floor(100000 + Math.random() * 900000));
    const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES, 10) || 10;
    const expiresAt     = new Date(Date.now() + expiryMinutes * 60 * 1000);
    // Store OTP plain — it's short-lived, single-use, and only 6 digits

    // Invalidate existing unused OTPs for same number + purpose
    await db.query(
      `UPDATE otp_logs SET is_used = TRUE
       WHERE mobile_number = ? AND purpose = ? AND is_used = FALSE`,
      [mobileNumber, purpose]
    );

    // Insert new OTP row
    await db.query(
      `INSERT INTO otp_logs (user_id, mobile_number, otp_code, purpose, is_used, expires_at)
       VALUES (?, ?, ?, ?, FALSE, ?)`,
      [userId, mobileNumber, otpCode, purpose, expiresAt]
    );

    // Send via iCloudSMS
    const authKey = process.env.ICLOUDSMS_AUTH_KEY;
    const senderId = process.env.ICLOUDSMS_SENDER_ID;
    const routeId = process.env.ICLOUDSMS_ROUTE_ID;
    const message = encodeURIComponent(`Your OTP for login is ${otpCode} . STPL`);

    const smsUrl = `http://msg.icloudsms.com/rest/services/sendSMS/sendGroupSms?AUTH_KEY=${authKey}&message=${message}&senderId=${senderId}&routeId=${routeId}&mobileNos=${mobileNumber}&smsContentType=english`;

    const smsRes = await fetch(smsUrl, { method: 'GET' });
    const smsData = await smsRes.text().catch(() => '');

    if (!smsRes.ok) {
      console.error('[OTPService] SMS delivery failed:', smsData);
      return { success: true, message: 'OTP generated but SMS delivery failed.' };
    }

    return { success: true, message: 'OTP sent successfully' };
  } catch (err) {
    console.error('[OTPService] sendOtp error:', err.message);
    throw err;
  }
};

/**
 * Verifies an OTP from the unit DB and marks it used.
 *
 * @param {object} db
 * @param {string} mobileNumber
 * @param {string} otp
 * @param {string} purpose
 * @returns {Promise<{ valid: boolean, message: string }>}
 */
const verifyOtp = async (db, mobileNumber, otp, purpose) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM otp_logs
       WHERE mobile_number = ? AND purpose = ? AND is_used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [mobileNumber, purpose]
    );

    if (rows.length === 0) {
      return { valid: false, message: 'Invalid or expired OTP' };
    }

    const logRow  = rows[0];
    const isMatch = (otp === logRow.otp_code);

    if (!isMatch) {
      return { valid: false, message: 'Invalid or expired OTP' };
    }

    await db.query(`UPDATE otp_logs SET is_used = TRUE WHERE id = ?`, [logRow.id]);

    return { valid: true, message: 'OTP verified successfully' };
  } catch (err) {
    console.error('[OTPService] verifyOtp error:', err.message);
    throw err;
  }
};

module.exports = { sendOtp, verifyOtp };
