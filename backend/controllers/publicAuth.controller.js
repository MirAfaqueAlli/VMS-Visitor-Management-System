// backend/controllers/publicAuth.controller.js
'use strict';

/**
 * Public contact verification — the building blocks the visitor portal uses for
 * registration (see visitorPortal.controller.js for sign-in and accounts).
 * Uses vms_central.public_otp_logs — no unit DB.
 *
 * SECURITY:
 *  - Phone OTP is handled by Firebase Phone Auth: the frontend's Firebase SDK sends
 *    and checks the SMS code, then gives us a Firebase idToken. We verify that token
 *    with firebase-admin (never trusting the browser) and confirm its phone number.
 *  - Email OTP codes are sent by our backend and stored only as SHA-256 hashes, with
 *    a wrong-guess limit and a resend cooldown.
 *  - A verified phone yields a short-lived phone_token (JWT purpose PHONE_VERIFIED)
 *    that /visitor-portal/register requires. Visit-request tokens (PUBLIC_VISITOR)
 *    are issued only to signed-in portal accounts (/visitor-portal/me/visitor-token).
 *
 * Endpoints:
 *  POST /send-phone-otp          → acknowledge (Firebase sends the SMS from the browser)
 *  POST /verify-firebase-phone   → verify Firebase idToken, phone matches → phone_token
 *  POST /send-email-otp          → generate + send OTP via email
 */

const jwt          = require('jsonwebtoken');
const {
  normalisePhone, sendEmailCode, checkFirebasePhone, sendDevPhoneCode, checkDevPhoneCode,
} = require('../services/contactVerification.service');
const { sendSuccess, sendError } = require('../utils/response.util');

const PHONE_TOKEN_EXPIRY = '30m';

// ── Send Phone OTP (Firebase sends the SMS itself from the browser) ───────────
// Validates the number. In development it also stands in for Firebase: the code
// is printed to the backend log (no SMS, no reCAPTCHA).
const sendPhoneOtp = async (req, res) => {
  try {
    const phone = normalisePhone(req.body.phone);
    if (phone.length !== 10) {
      return sendError(res, 'A valid 10-digit mobile number is required.', 400);
    }

    // Whether a number has visited before is told only after its OTP is verified
    // (existing-visitor-verify) — never here, or anyone could probe which phone
    // numbers have visited OHPC.

    if (process.env.NODE_ENV !== 'production') {
      const sent = await sendDevPhoneCode(phone);
      if (sent.status === 'cooldown') {
        return sendError(res, 'A code was sent recently. Please wait 20 seconds before requesting another.', 429);
      }
      return sendSuccess(res, {}, 'Development mode: the SMS code is printed in the backend log.', 200);
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
    const { idToken, otp } = req.body;
    if (phone.length !== 10 || !(idToken || otp)) return sendError(res, 'phone and idToken are required.', 400);

    // 400 rather than 401: the frontend treats any 401 as an expired staff session
    if (otp) {
      // Development only: a code from send-phone-otp (always rejected in production)
      if (!(await checkDevPhoneCode(phone, otp))) return sendError(res, 'Invalid or expired OTP. Please try again.', 400);
    } else {
      const check = await checkFirebasePhone(idToken, phone);
      if (check === 'invalid')  return sendError(res, 'Phone verification failed. Please try again.', 400);
      if (check === 'mismatch') return sendError(res, 'Phone number mismatch. Please verify the correct number.', 400);
    }

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
      return sendError(res, 'A code was sent recently. Please wait 20 seconds before requesting another.', 429);
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

module.exports = {
  sendPhoneOtp,
  verifyFirebasePhone,
  sendEmailOtp,
};
