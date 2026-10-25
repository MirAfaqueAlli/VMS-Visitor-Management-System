// backend/services/otp.service.js
'use strict';

/**
 * OTP Service — unit-DB aware.
 * All functions accept a `db` parameter (the unit pool from req.db).
 * otp_logs lives in the unit DB (per vms_unit_schema.sql).
 *
 * SECURITY: OTP codes are stored as SHA-256 hashes — never in plaintext.
 * At verification, the user-supplied OTP is hashed before comparison.
 *
 * @param {object} db - mysql2/promise pool (req.db)
 */

const { hashOtp, generateOtp, MAX_OTP_ATTEMPTS } = require('../utils/crypto.util');
const smsService = require('./sms.service');

/**
 * Generates a 6-digit OTP, invalidates old ones for the same mobile+purpose,
 * saves the HASHED OTP to otp_logs, and attempts Fast2SMS delivery.
 *
 * @param {object} db
 * @param {string} mobileNumber
 * @param {string} purpose
 * @param {number|null} userId
 * @returns {Promise<{ success: boolean, message: string }>}
 */
const sendOtp = async (db, mobileNumber, purpose, userId = null) => {
  try {
    const otpCode       = generateOtp();
    const otpHash       = hashOtp(otpCode);   // hash before storing
    const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES, 10) || 10;
    const expiresAt     = new Date(Date.now() + expiryMinutes * 60 * 1000);

    // Invalidate existing unused OTPs for same number + purpose
    await db.query(
      `UPDATE otp_logs SET is_used = TRUE
       WHERE mobile_number = ? AND purpose = ? AND is_used = FALSE`,
      [mobileNumber, purpose]
    );

    // Insert new OTP row — store the hash, not the raw code
    await db.query(
      `INSERT INTO otp_logs (user_id, mobile_number, otp_code, purpose, is_used, expires_at)
       VALUES (?, ?, ?, ?, FALSE, ?)`,
      [userId, mobileNumber, otpHash, purpose, expiresAt]
    );

    // Send the raw OTP by SMS only (it is never stored raw). This previously called
    // fetch() with an undefined `smsUrl`, so it crashed whenever a key was set.
    const sms = await smsService.sendOtpSms(mobileNumber, otpCode);
    if (!sms.success) {
      // Never log the actual OTP code — even in dev logs
      console.error(`[OTPService] SMS delivery failed for ${mobileNumber.slice(0, 4)}****: ${sms.error}`);
      return { success: false, message: 'OTP could not be sent by SMS. Please try again later.' };
    }

    return { success: true, message: 'OTP sent successfully' };
  } catch (err) {
    console.error('[OTPService] sendOtp error:', err.message);
    throw err;
  }
};

/**
 * Verifies an OTP from the unit DB and marks it used.
 * Compares the SHA-256 hash of the user-supplied OTP against the stored hash.
 *
 * @param {object} db
 * @param {string} mobileNumber
 * @param {string} otp         - Raw OTP provided by the user
 * @param {string} purpose
 * @returns {Promise<{ valid: boolean, message: string }>}
 */
const verifyOtp = async (db, mobileNumber, otp, purpose) => {
  try {
    const [rows] = await db.query(
      `SELECT id, otp_code FROM otp_logs
       WHERE mobile_number = ? AND purpose = ? AND is_used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [mobileNumber, purpose]
    );

    if (rows.length === 0) {
      return { valid: false, message: 'Invalid or expired OTP' };
    }

    const logRow       = rows[0];

    // Count this attempt atomically *before* comparing, so parallel guesses
    // can't get past MAX_OTP_ATTEMPTS
    const [claim] = await db.query(
      `UPDATE otp_logs SET attempts = attempts + 1
       WHERE id = ? AND is_used = FALSE AND attempts < ?`,
      [logRow.id, MAX_OTP_ATTEMPTS]
    );
    if (claim.affectedRows === 0) {
      return { valid: false, message: 'Too many incorrect attempts. Please request a new OTP.' };
    }

    const suppliedHash = hashOtp(otp);   // hash what the user typed
    if (suppliedHash !== logRow.otp_code) {
      return { valid: false, message: 'Invalid or expired OTP' };
    }

    // Consume it (affectedRows guards against a parallel success)
    const [consumed] = await db.query(
      'UPDATE otp_logs SET is_used = TRUE WHERE id = ? AND is_used = FALSE', [logRow.id]
    );
    if (consumed.affectedRows === 0) {
      return { valid: false, message: 'Invalid or expired OTP' };
    }

    return { valid: true, message: 'OTP verified successfully' };
  } catch (err) {
    console.error('[OTPService] verifyOtp error:', err.message);
    throw err;
  }
};

module.exports = { sendOtp, verifyOtp };
