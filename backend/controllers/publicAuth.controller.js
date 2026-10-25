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
const { normalisePhone, sendEmailCode, checkEmailCode, checkFirebasePhone } = require('../services/contactVerification.service');
const { sendSuccess, sendError } = require('../utils/response.util');

const VISITOR_TOKEN_EXPIRY = '30m';
const PHONE_TOKEN_EXPIRY   = '30m';

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

    // 400 rather than 401: the frontend treats any 401 as an expired staff session
    const check = await checkFirebasePhone(idToken, phone);
    if (check === 'invalid')  return sendError(res, 'Phone verification failed. Please try again.', 400);
    if (check === 'mismatch') return sendError(res, 'Phone number mismatch. Please verify the correct number.', 400);

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

    const sent = await sendEmailCode(email);
    if (sent.status === 'cooldown') {
      return sendError(res, 'A code was sent recently. Please wait 60 seconds before requesting another.', 429);
    }
    if (sent.status === 'failed') {
      if (!sent.devOtp) {
        return sendError(res, 'Failed to send email OTP. Please check your email address or contact support.', 500);
      }
      // DEV / TEST MODE: expose OTP in response body
      return sendSuccess(res,
        { dev_otp: sent.devOtp, dev_note: 'OTP returned because email delivery failed (non-production mode only).' },
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
      return sendError(res, 'Please verify your mobile number first.', 400);
    }

    const valid = await checkEmailCode(email, otp);
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
