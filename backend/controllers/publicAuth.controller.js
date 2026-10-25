// backend/controllers/publicAuth.controller.js
'use strict';

/**
 * Public Visitor Authentication
 * Provides OTP-based identity verification for the public request form
 * (tender 1.1.1 "Prior Approval for Out-side Visitor": name, address, email,
 * mobile; mobile verified by OTP). Uses vms_central.public_otp_logs — no unit DB.
 *
 * SECURITY:
 *  - Phone OTP is handled by Firebase Phone Auth: the frontend's Firebase SDK sends
 *    and checks the SMS code, then gives us a Firebase idToken. We verify that token
 *    with firebase-admin (never trusting the browser) and confirm its phone number.
 *  - Email OTP codes are sent by our backend and stored only as SHA-256 hashes, with
 *    a wrong-guess limit and a 60-second resend limit.
 *  - A verified phone yields a short-lived phone_token (JWT purpose PHONE_VERIFIED);
 *    verify-email-otp requires it, so the visitor token can only ever vouch for a
 *    phone number that really was verified.
 *
 * Flow:
 *  1. POST /send-phone-otp          → acknowledge (Firebase sends the SMS from the browser)
 *  2. POST /verify-firebase-phone   → verify Firebase idToken, phone matches → phone_token
 *  3. POST /send-email-otp          → generate + send OTP via email
 *  4. POST /verify-email-otp        → validate email OTP (+ phone_token) → visitor session JWT
 */

const jwt          = require('jsonwebtoken');
const { auth: firebaseAuth } = require('../utils/firebaseAdmin');
const { centralPool } = require('../services/dbManager');
const emailService = require('../services/email.service');
const { sendSuccess, sendError } = require('../utils/response.util');
const { hashOtp, generateOtp, MAX_OTP_ATTEMPTS } = require('../utils/crypto.util');

const OTP_EXPIRY_MINUTES   = parseInt(process.env.OTP_EXPIRY_MINUTES, 10) || 10;
const VISITOR_TOKEN_EXPIRY = '30m';
const PHONE_TOKEN_EXPIRY   = '30m';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Mobile numbers are keyed and compared as their last 10 digits. */
const normalisePhone = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);

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
 * Each OTP allows MAX_OTP_ATTEMPTS guesses; after that a new one must be requested.
 */
async function validateOtp(identifier, identifierType, otp) {
  const [rows] = await centralPool.query(
    `SELECT id, otp_code FROM public_otp_logs
     WHERE identifier = ? AND identifier_type = ? AND is_used = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [identifier, identifierType]
  );
  if (!rows.length) return false;

  // Count this attempt atomically *before* comparing, so parallel guesses
  // can't get past MAX_OTP_ATTEMPTS
  const [claim] = await centralPool.query(
    `UPDATE public_otp_logs SET attempts = attempts + 1
     WHERE id = ? AND is_used = FALSE AND attempts < ?`,
    [rows[0].id, MAX_OTP_ATTEMPTS]
  );
  if (claim.affectedRows === 0 || rows[0].otp_code !== hashOtp(otp)) return false;

  // Consume it (affectedRows guards against a parallel success)
  const [consumed] = await centralPool.query(
    'UPDATE public_otp_logs SET is_used = TRUE WHERE id = ? AND is_used = FALSE', [rows[0].id]
  );
  return consumed.affectedRows === 1;
}

/** Rejects a resend within 60 seconds of the last code for this identifier. */
async function sentRecently(identifier, identifierType) {
  const [rows] = await centralPool.query(
    `SELECT id FROM public_otp_logs
     WHERE identifier = ? AND identifier_type = ? AND created_at > NOW() - INTERVAL 60 SECOND
     LIMIT 1`,
    [identifier, identifierType]
  );
  return rows.length > 0;
}

// ── Send Phone OTP (Firebase sends the SMS itself from the browser) ───────────
// Kept so the frontend flow has a "send" step that validates the number.
const sendPhoneOtp = async (req, res) => {
  try {
    const phone = normalisePhone(req.body.phone);
    if (phone.length !== 10) {
      return sendError(res, 'A valid 10-digit mobile number is required.', 400);
    }
    return sendSuccess(res, {}, 'Use the OTP sent to your phone.', 200);
  } catch (err) {
    console.error('[PublicAuth] sendPhoneOtp error:', err.message);
    return sendError(res, 'Failed to initiate phone verification.', 500);
  }
};

// ── Verify Firebase Phone ID Token ────────────────────────────────────────────
/**
 * POST /api/public-auth/verify-firebase-phone
 * Body: { phone, idToken }
 *
 * After Firebase checks the SMS code in the browser it issues a short-lived idToken.
 * We verify it with firebase-admin, confirm its phone_number (E.164, +91…) matches
 * the number the visitor entered, and return a phone_token for verify-email-otp.
 */
const verifyFirebasePhone = async (req, res) => {
  try {
    const phone = normalisePhone(req.body.phone);
    const { idToken } = req.body;
    if (phone.length !== 10 || !idToken) return sendError(res, 'phone and idToken are required.', 400);

    let decoded;
    try {
      decoded = await firebaseAuth.verifyIdToken(idToken);
    } catch (firebaseErr) {
      console.error('[PublicAuth] Firebase token verification failed:', firebaseErr.message);
      return sendError(res, 'Phone verification failed. Please try again.', 401);
    }
    if (normalisePhone(decoded.phone_number) !== phone) {
      return sendError(res, 'Phone number mismatch. Please verify the correct number.', 400);
    }

    // We only need the proof, not a Firebase account: delete the user record Firebase
    // created for this phone, so visitors' numbers don't accumulate at Google
    firebaseAuth.deleteUser(decoded.uid)
      .catch(err => console.warn('[PublicAuth] Could not delete Firebase user after verification:', err.message));

    const phoneToken = jwt.sign(
      { purpose: 'PHONE_VERIFIED', phone },
      process.env.JWT_SECRET,
      { expiresIn: PHONE_TOKEN_EXPIRY }
    );
    return sendSuccess(res, { phone_verified: true, phone_token: phoneToken }, 'Phone verified successfully.', 200);
  } catch (err) {
    console.error('[PublicAuth] verifyFirebasePhone error:', err.message);
    return sendError(res, 'Failed to verify phone.', 500);
  }
};

// ── Send Email OTP ────────────────────────────────────────────────────────────
const sendEmailOtp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendError(res, 'A valid email address is required.', 400);
    }

    // Rate-limit: max 1 code per 60 seconds per email (stops email bombing)
    if (await sentRecently(email, 'email')) {
      return sendError(res, 'A code was sent recently. Please wait 60 seconds before requesting another.', 429);
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
    const { email, otp, visitor_name, visitor_phone, visitor_address, phone_token } = req.body;

    if (!email || !otp) return sendError(res, 'email and otp are required.', 400);
    if (!visitor_name || !visitor_phone || !visitor_address) {
      return sendError(res, 'visitor_name, visitor_phone and visitor_address are required.', 400);
    }

    // The visitor token below vouches for visitor_phone, so require the proof from
    // verify-phone-otp — checked before the email OTP is consumed.
    let phoneProof = null;
    try { phoneProof = jwt.verify(phone_token, process.env.JWT_SECRET); } catch { /* invalid/expired */ }
    const phone = normalisePhone(visitor_phone);
    if (!phoneProof || phoneProof.purpose !== 'PHONE_VERIFIED' || phoneProof.phone !== phone) {
      return sendError(res, 'Please verify your mobile number first.', 401);
    }

    const valid = await validateOtp(email, 'email', otp);
    if (!valid) return sendError(res, 'Invalid or expired OTP. Please try again.', 400);

    // Short-lived visitor session token: the identity the public request is created with
    const visitorToken = jwt.sign(
      {
        purpose:         'PUBLIC_VISITOR',
        visitor_name:    visitor_name.trim(),
        visitor_phone:   phone,
        visitor_email:   email.trim(),
        visitor_address: visitor_address.trim(),
        phone_verified:  true,
        email_verified:  true,
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

module.exports = { sendPhoneOtp, verifyFirebasePhone, sendEmailOtp, verifyEmailOtp };
