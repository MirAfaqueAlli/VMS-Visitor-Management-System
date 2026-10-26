// backend/services/contactVerification.service.js
'use strict';

/**
 * Email and mobile-number verification, shared by the public visitor form
 * (publicAuth.controller) and first-time setup (setup.controller).
 *
 *  - Email: we send a 6-digit code and keep only its SHA-256 hash in
 *    vms_central.public_otp_logs, with a wrong-guess limit and a 60-second
 *    resend limit.
 *  - Mobile: Firebase Phone Auth sends and checks the SMS code in the browser,
 *    then gives the browser an idToken. We verify that token with firebase-admin
 *    (never trusting the browser) and compare its phone number.
 *
 * Development (NODE_ENV !== 'production'): every code is printed to the backend
 * console, and mobile codes skip Firebase/reCAPTCHA entirely — they are stored
 * like email codes and only logged (sendDevPhoneCode / checkDevPhoneCode).
 */

const { auth: firebaseAuth } = require('../utils/firebaseAdmin');
const { centralPool } = require('./dbManager');
const emailService = require('./email.service');
const { hashOtp, generateOtp, MAX_OTP_ATTEMPTS } = require('../utils/crypto.util');

const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES, 10) || 10;

const isProduction = () => process.env.NODE_ENV === 'production';
const logDevCode   = (channel, target, otp) =>
  console.log(`\n========================================\n[DEV OTP] ${channel} code for ${target}: ${otp}\n========================================\n`);

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

/** True if a code was sent for this identifier in the last 60 seconds. */
async function sentRecently(identifier, identifierType) {
  const [rows] = await centralPool.query(
    `SELECT id FROM public_otp_logs
     WHERE identifier = ? AND identifier_type = ? AND created_at > NOW() - INTERVAL 60 SECOND
     LIMIT 1`,
    [identifier, identifierType]
  );
  return rows.length > 0;
}

/**
 * Emails a verification code to `email`. `key` is what the code is stored under
 * (default: the address itself); setup passes its own key so its codes never
 * clash with the public form's.
 *
 * @returns {Promise<{status: 'sent'} | {status: 'cooldown'} | {status: 'failed', devOtp?: string}>}
 *   devOtp comes back only outside production, so a missing mail server
 *   doesn't block local testing.
 */
async function sendEmailCode(email, key = email) {
  // Max 1 code per 60 seconds per address (stops email bombing)
  if (await sentRecently(key, 'email')) return { status: 'cooldown' };

  const otp    = await storeOtp(key, 'email', generateOtp());
  if (!isProduction()) logDevCode('Email', email, otp);
  const tmpl   = emailService.otpTemplate(otp, 'email');
  const result = await emailService.sendEmail({ to: email, subject: tmpl.subject, html: tmpl.html });
  if (result.success) return { status: 'sent' };

  console.error('[ContactVerification] Email OTP delivery failed:', result.error);
  return process.env.NODE_ENV === 'production' ? { status: 'failed' } : { status: 'failed', devOtp: otp };
}

/** True if `otp` is the current code stored under `key` (the code is then used up). */
const checkEmailCode = (key, otp) => validateOtp(key, 'email', otp);

/**
 * Verifies the idToken Firebase gave the browser after the SMS code was entered,
 * and checks it was issued for `phone`.
 * @returns {Promise<'ok' | 'invalid' | 'mismatch'>}
 */
async function checkFirebasePhone(idToken, phone) {
  let decoded;
  try {
    decoded = await firebaseAuth.verifyIdToken(idToken);
  } catch (err) {
    console.error('[ContactVerification] Firebase token verification failed:', err.message);
    return 'invalid';
  }
  if (normalisePhone(decoded.phone_number) !== normalisePhone(phone)) return 'mismatch';

  // We only need the proof, not a Firebase account: delete the user record Firebase
  // created for this phone, so numbers don't accumulate at Google
  firebaseAuth.deleteUser(decoded.uid)
    .catch(err => console.warn('[ContactVerification] Could not delete Firebase user after verification:', err.message));
  return 'ok';
}

/**
 * Development only — stands in for Firebase: stores a mobile code like an email
 * code and prints it to the backend console (no SMS, no reCAPTCHA).
 * @returns {Promise<{status: 'sent' | 'cooldown' | 'disabled'}>} 'disabled' in production
 */
async function sendDevPhoneCode(phone, key = normalisePhone(phone)) {
  if (isProduction()) return { status: 'disabled' };
  if (await sentRecently(key, 'phone')) return { status: 'cooldown' };
  const otp = await storeOtp(key, 'phone', generateOtp());
  logDevCode('SMS', phone, otp);
  return { status: 'sent' };
}

/** Development only: checks a code from sendDevPhoneCode (always false in production). */
const checkDevPhoneCode = async (key, otp) => !isProduction() && validateOtp(key, 'phone', otp);

module.exports = {
  normalisePhone, sendEmailCode, checkEmailCode, checkFirebasePhone,
  sendDevPhoneCode, checkDevPhoneCode,
};
