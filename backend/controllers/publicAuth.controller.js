// backend/controllers/publicAuth.controller.js
'use strict';

/**
 * Public Visitor Authentication
 * Provides OTP-based identity verification for the public request form.
 * Uses vms_central.public_otp_logs — no unit DB required.
 *
 * SECURITY:
 *  - OTP codes are stored as SHA-256 hashes in public_otp_logs (never plaintext).
 *  - The visitor JWT contains only a verification flag (aadhaar_verified: true),
 *    NOT the raw Aadhaar number. The raw number is forwarded via the request body
 *    and stored encrypted server-side when the visit request is created.
 *
 * Flow:
 *  1. POST /send-phone-otp   → generate + send OTP via Fast2SMS
 *  2. POST /verify-phone-otp → validate phone OTP
 *  3. POST /send-email-otp   → generate + send OTP via email
 *  4. POST /verify-email-otp → validate email OTP → issue visitor session JWT
 */

const jwt = require('jsonwebtoken');
const { centralPool } = require('../services/dbManager');
const emailService    = require('../services/email.service');
const { sendSuccess, sendError } = require('../utils/response.util');
const { hashOtp }     = require('../utils/crypto.util');

const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES, 10) || 10;
const VISITOR_TOKEN_EXPIRY = '30m';

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Stores the SHA-256 hash of the OTP (never the raw code).
 * Invalidates any prior unused OTPs for the same identifier+type.
 */
async function storeOtp(identifier, identifierType, otpCode) {
  const otpHash   = hashOtp(otpCode);   // hash before storing
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  // Invalidate existing unused OTPs for same identifier + type
  await centralPool.query(
    `UPDATE public_otp_logs SET is_used = TRUE
     WHERE identifier = ? AND identifier_type = ? AND is_used = FALSE`,
    [identifier, identifierType]
  );
  await centralPool.query(
    `INSERT INTO public_otp_logs (identifier, identifier_type, otp_code, is_used, expires_at)
     VALUES (?, ?, ?, FALSE, ?)`,
    [identifier, identifierType, otpHash, expiresAt]
  );
  // Return the raw OTP so we can send it via SMS/email (never stored raw)
  return otpCode;
}

/**
 * Validates a user-supplied OTP by comparing its hash to the stored hash.
 */
async function validateOtp(identifier, identifierType, otp) {
  const suppliedHash = hashOtp(otp);

  const [rows] = await centralPool.query(
    `SELECT id, otp_code FROM public_otp_logs
     WHERE identifier = ? AND identifier_type = ? AND is_used = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [identifier, identifierType]
  );
  if (!rows.length || rows[0].otp_code !== suppliedHash) {
    return false;
  }
  await centralPool.query('UPDATE public_otp_logs SET is_used = TRUE WHERE id = ?', [rows[0].id]);
  return true;
}

// ── Send Phone OTP ────────────────────────────────────────────────────────────
const sendPhoneOtp = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || !/^\d{10,15}$/.test(phone.replace(/\s+/g, ''))) {
      return sendError(res, 'A valid phone number is required.', 400);
    }

    const otp = await storeOtp(phone, 'phone', generateOtp());

    const apiKey = process.env.FAST2SMS_API_KEY;
    if (!apiKey) {
      console.warn(`[PublicAuth] FAST2SMS_API_KEY not set. OTP generated for ${phone.slice(0, 4)}****`);

      // ── Dev / test fallback ──────────────────────────────────────────────────
      // In production the SMS key MUST be configured — fail loudly.
      // In development/testing, return the OTP directly so the flow can be tested
      // without an SMS gateway.
      if (process.env.NODE_ENV === 'production') {
        return sendError(res, 'SMS service is not configured. Contact the system administrator.', 503);
      }
      // DEV / TEST MODE: expose OTP in response body for easier manual testing
      return sendSuccess(res,
        { dev_otp: otp, dev_note: 'OTP returned because FAST2SMS_API_KEY is not set (non-production mode only).' },
        'OTP generated (dev mode — no SMS sent). Use the otp value from this response to verify.',
        200
      );
    }

    const body = new URLSearchParams({
      route: 'otp',
      variables_values: otp,   // raw OTP sent via SMS only — stored hash in DB
      numbers: phone.replace(/\s+/g, ''),
      flash: '0',
    });

    const smsRes = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: { authorization: apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const smsData = await smsRes.json().catch(() => ({}));

    if (!smsRes.ok || smsData.return === false) {
      console.error('[PublicAuth] Fast2SMS failed:', smsData);
      return sendError(res, 'Failed to send SMS. Please try again.', 500);
    }

    return sendSuccess(res, {}, 'OTP sent to your phone.', 200);
  } catch (err) {
    console.error('[PublicAuth] sendPhoneOtp error:', err.message);
    return sendError(res, 'Failed to send phone OTP.', 500);
  }
};

// ── Verify Phone OTP ──────────────────────────────────────────────────────────
const verifyPhoneOtp = async (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) return sendError(res, 'phone and otp are required.', 400);

    const valid = await validateOtp(phone, 'phone', otp);
    if (!valid) return sendError(res, 'Invalid or expired OTP. Please try again.', 400);

    return sendSuccess(res, { phone_verified: true }, 'Phone verified successfully.', 200);
  } catch (err) {
    console.error('[PublicAuth] verifyPhoneOtp error:', err.message);
    return sendError(res, 'Failed to verify phone OTP.', 500);
  }
};

// ── Send Email OTP ────────────────────────────────────────────────────────────
const sendEmailOtp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendError(res, 'A valid email address is required.', 400);
    }

    const otp = await storeOtp(email, 'email', generateOtp());

    const tmpl = emailService.otpTemplate(otp, 'email');
    const result = await emailService.sendEmail({ to: email, subject: tmpl.subject, html: tmpl.html });

    if (!result.success) {
      console.error('[PublicAuth] Email OTP delivery failed:', result.error);

      // ── Dev / test fallback ──────────────────────────────────────────────────
      if (process.env.NODE_ENV === 'production') {
        return sendError(res, 'Failed to send email OTP. Please check your email address or contact support.', 500);
      }
      // DEV / TEST MODE: expose OTP in response body
      return sendSuccess(res,
        { dev_otp: otp, dev_note: 'OTP returned because email delivery failed (non-production mode only).' },
        'OTP generated (dev mode — email delivery failed). Use the otp value from this response to verify.',
        200
      );
    }

    return sendSuccess(res, {}, 'OTP sent to your email.', 200);
  } catch (err) {
    console.error('[PublicAuth] sendEmailOtp error:', err.message);
    return sendError(res, 'Failed to send email OTP.', 500);
  }
};

// ── Verify Email OTP + Issue Visitor Token ────────────────────────────────────
const verifyEmailOtp = async (req, res) => {
  try {
    const { email, otp, visitor_name, visitor_phone, aadhaar_number } = req.body;

    if (!email || !otp) return sendError(res, 'email and otp are required.', 400);
    if (!visitor_name || !visitor_phone) {
      return sendError(res, 'visitor_name and visitor_phone are required.', 400);
    }

    // Aadhaar is required for public requests — validate strictly
    const cleanAadhaar = aadhaar_number ? aadhaar_number.replace(/[\s-]/g, '') : '';
    if (!cleanAadhaar || !/^\d{12}$/.test(cleanAadhaar)) {
      return sendError(res, 'A valid 12-digit Aadhaar number is required.', 400);
    }

    const valid = await validateOtp(email, 'email', otp);
    if (!valid) return sendError(res, 'Invalid or expired OTP. Please try again.', 400);

    // Issue a short-lived visitor session token.
    // SECURITY: The raw Aadhaar number is NOT embedded in the JWT (JWTs are only
    // base64-encoded, not encrypted). We store only a verification flag.
    // The frontend must re-send the aadhaar_number in the visit request body,
    // where the backend will encrypt it before persisting.
    const visitorToken = jwt.sign(
      {
        purpose:          'PUBLIC_VISITOR',
        visitor_name:     visitor_name.trim(),
        visitor_phone:    visitor_phone.trim(),
        visitor_email:    email.trim(),
        phone_verified:   true,
        email_verified:   true,
        aadhaar_verified: true,   // confirmation flag only — raw number NOT included
      },
      process.env.JWT_SECRET,
      { expiresIn: VISITOR_TOKEN_EXPIRY }
    );

    return sendSuccess(
      res,
      { visitor_token: visitorToken },
      'Identity verified. You may now submit your visit request.',
      200
    );
  } catch (err) {
    console.error('[PublicAuth] verifyEmailOtp error:', err.message);
    return sendError(res, 'Failed to verify email OTP.', 500);
  }
};

module.exports = { sendPhoneOtp, verifyPhoneOtp, sendEmailOtp, verifyEmailOtp };
