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
const bcrypt       = require('bcrypt');
const {
  normalisePhone, sendEmailCode, checkEmailCode, checkFirebasePhone, sendDevPhoneCode, checkDevPhoneCode,
} = require('../services/contactVerification.service');
const { queryAllUnits, centralPool, getPool } = require('../services/dbManager');
const { sendSuccess, sendError } = require('../utils/response.util');
const { validatePassword } = require('../utils/passwordValidator.util');
const { getSignedFileUrl } = require('../utils/s3.util');
const { sendNotification } = require('../services/notification.service');
const emailService = require('../services/email.service');

const VISITOR_TOKEN_EXPIRY = '30m';
const PHONE_TOKEN_EXPIRY   = '30m';

/**
 * Searches ONLY for visitors who registered through the public portal endpoint (/public-request).
 *
 * NOTE: Employee visits, spot walk-ins created at reception/gate, and internal visits
 * are strictly EXCLUDED. Only visitors who registered through the public request endpoint
 * (stored in vms_central.public_registered_visitors or past visit_requests with request_source = 'PUBLIC')
 * are recognized as registered public portal users.
 */
async function findExistingVisitorByPhone(phone) {
  const cleanPhone = normalisePhone(phone);
  if (!cleanPhone || cleanPhone.length !== 10) return null;

  // 1. Search central public_registered_visitors table (the primary source of truth for public registrants)
  try {
    const [centralRows] = await centralPool.query(
      `SELECT full_name, email, phone, address, company_name, password_hash, created_at
       FROM public_registered_visitors
       WHERE phone = ? OR phone = ? OR RIGHT(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', ''), 10) = ?
       LIMIT 1`,
      [cleanPhone, `+91${cleanPhone}`, cleanPhone]
    );
    if (centralRows && centralRows.length > 0) {
      const row = centralRows[0];
      return {
        visitor_name:    row.full_name.trim(),
        visitor_phone:   cleanPhone,
        visitor_email:   (row.email || '').trim(),
        visitor_address: (row.address || '').trim(),
        company_name:    (row.company_name || '').trim(),
        password_hash:   row.password_hash || null,
      };
    }
  } catch (centralErr) {
    console.warn('[PublicAuth] findExistingVisitorByPhone central table error:', centralErr.message);
  }

  // 2. Fallback: Search past visit_requests across units, but ONLY where request_source = 'PUBLIC'!
  // This supports visitors who registered via /public-request before the central table existed.
  // EMPLOYEE visits (request_source = 'SELF'/'HOST') and SPOT visits (request_source = 'RECEPTION') are strictly excluded!
  const publicReqSql = `
    SELECT 
      visitor_name,
      visitor_phone,
      visitor_email,
      visitor_address,
      company_name,
      created_at
    FROM visit_requests
    WHERE request_source = 'PUBLIC'
      AND (
        visitor_phone = ?
        OR visitor_phone = ?
        OR REPLACE(REPLACE(REPLACE(visitor_phone, ' ', ''), '-', ''), '+', '') = ?
        OR RIGHT(REPLACE(REPLACE(REPLACE(visitor_phone, ' ', ''), '-', ''), '+', ''), 10) = ?
      )
    ORDER BY created_at DESC
    LIMIT 1
  `;

  let bestRecord = null;
  try {
    const results = await queryAllUnits(publicReqSql, [phone, cleanPhone, cleanPhone, cleanPhone]);
    for (const res of results) {
      if (res.rows && res.rows.length > 0) {
        const row = res.rows[0];
        if (!bestRecord || new Date(row.created_at) > new Date(bestRecord.created_at)) {
          bestRecord = row;
        }
      }
    }
  } catch (err) {
    console.warn('[PublicAuth] findExistingVisitorByPhone public visit_requests error:', err.message);
  }

  if (bestRecord && bestRecord.visitor_name && bestRecord.visitor_name.trim()) {
    const profile = {
      visitor_name:    bestRecord.visitor_name.trim(),
      visitor_phone:   cleanPhone,
      visitor_email:   (bestRecord.visitor_email || '').trim(),
      visitor_address: (bestRecord.visitor_address || '').trim(),
      company_name:    (bestRecord.company_name || '').trim(),
      password_hash:   null,
    };

    // Cache this public visitor into public_registered_visitors for future fast lookups
    try {
      await centralPool.query(
        `INSERT IGNORE INTO public_registered_visitors (phone, full_name, email, address, company_name, created_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [cleanPhone, profile.visitor_name, profile.visitor_email, profile.visitor_address, profile.company_name]
      );
    } catch (_) {}

    return profile;
  }

  // If not found in public_registered_visitors and not in request_source = 'PUBLIC', return null!
  // Any spot walk-in, employee visit, or gate visitor is NOT a public registered visitor.
  return null;
}

/**
 * Searches ONLY for visitors who registered through the public portal by their email address.
 */
async function findExistingVisitorByEmail(email) {
  if (!email || !email.trim()) return null;
  const cleanEmail = email.trim().toLowerCase();

  // 1. Central table lookup
  try {
    const [centralRows] = await centralPool.query(
      `SELECT full_name, email, phone, address, company_name, password_hash, created_at
       FROM public_registered_visitors
       WHERE LOWER(TRIM(email)) = ?
       LIMIT 1`,
      [cleanEmail]
    );
    if (centralRows && centralRows.length > 0) {
      const row = centralRows[0];
      return {
        visitor_name:    row.full_name.trim(),
        visitor_phone:   normalisePhone(row.phone),
        visitor_email:   row.email.trim(),
        visitor_address: (row.address || '').trim(),
        company_name:    (row.company_name || '').trim(),
        password_hash:   row.password_hash || null,
      };
    }
  } catch (err) {
    console.warn('[PublicAuth] findExistingVisitorByEmail central table error:', err.message);
  }

  // 2. Fallback: check visit_requests where request_source = 'PUBLIC'
  const publicReqSql = `
    SELECT visitor_name, visitor_phone, visitor_email, visitor_address, company_name, created_at
    FROM visit_requests
    WHERE request_source = 'PUBLIC' AND LOWER(TRIM(visitor_email)) = ?
    ORDER BY created_at DESC
    LIMIT 1
  `;
  try {
    const results = await queryAllUnits(publicReqSql, [cleanEmail]);
    for (const res of results) {
      if (res.rows && res.rows.length > 0) {
        const row = res.rows[0];
        const profile = {
          visitor_name:    row.visitor_name.trim(),
          visitor_phone:   normalisePhone(row.visitor_phone),
          visitor_email:   (row.visitor_email || cleanEmail).trim(),
          visitor_address: (row.visitor_address || '').trim(),
          company_name:    (row.company_name || '').trim(),
          password_hash:   null,
        };
        try {
          await centralPool.query(
            `INSERT IGNORE INTO public_registered_visitors (phone, full_name, email, address, company_name, created_at)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [profile.visitor_phone, profile.visitor_name, profile.visitor_email, profile.visitor_address, profile.company_name]
          );
        } catch (_) {}
        return profile;
      }
    }
  } catch (err) {
    console.warn('[PublicAuth] findExistingVisitorByEmail public visit_requests error:', err.message);
  }

  return null;
}

/**
 * Searches for a registered public visitor by either Email OR 10-digit Phone number.
 */
async function findExistingVisitorByIdentifier(identifier) {
  if (!identifier || typeof identifier !== 'string') return null;
  const raw = identifier.trim();
  if (!raw) return null;

  // If contains @, prioritize email lookup
  if (raw.includes('@')) {
    return await findExistingVisitorByEmail(raw);
  }

  // If digits / phone format, look up by phone
  const cleanPhone = normalisePhone(raw);
  if (cleanPhone && cleanPhone.length === 10) {
    const byPhone = await findExistingVisitorByPhone(cleanPhone);
    if (byPhone) return byPhone;
  }

  // Fallback: try email in case it's a domain-less format or username
  return await findExistingVisitorByEmail(raw);
}

// ── Check if phone number is registered ───────────────────────────────────────
const checkPhone = async (req, res) => {
  try {
    const phone = normalisePhone(req.body.phone || req.query.phone);
    if (!phone || phone.length !== 10) {
      return sendError(res, 'A valid 10-digit mobile number is required.', 400);
    }
    const existing = await findExistingVisitorByPhone(phone);
    const registered = !!(existing && existing.visitor_name);
    return sendSuccess(
      res,
      {
        registered,
        phone,
        visitor_name: registered ? existing.visitor_name : null,
      },
      registered
        ? 'Mobile number is already registered through this portal. Please login.'
        : 'Mobile number has not been registered through this portal. Please register as a new visitor.'
    );
  } catch (err) {
    console.error('[PublicAuth] checkPhone error:', err.message);
    return sendError(res, 'Failed to check mobile number.', 500);
  }
};

// ── Check if email address is registered ──────────────────────────────────────
const checkEmail = async (req, res) => {
  try {
    const email = (req.body.email || req.query.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendError(res, 'A valid email address is required.', 400);
    }
    const existing = await findExistingVisitorByEmail(email);
    const registered = !!(existing && existing.visitor_name);
    return sendSuccess(
      res,
      {
        registered,
        email,
        visitor_name: registered ? existing.visitor_name : null,
      },
      registered
        ? 'Email is already registered through this portal. Please login.'
        : 'Email has not been registered through this portal. Please register as a new visitor.'
    );
  } catch (err) {
    console.error('[PublicAuth] checkEmail error:', err.message);
    return sendError(res, 'Failed to check email address.', 500);
  }
};

// ── Send Phone OTP (Firebase sends the SMS itself from the browser) ───────────
// Validates the number. In development it also stands in for Firebase: the code
// is printed to the backend log (no SMS, no reCAPTCHA).
const sendPhoneOtp = async (req, res) => {
  try {
    const phone = normalisePhone(req.body.phone);
    if (phone.length !== 10) {
      return sendError(res, 'A valid 10-digit mobile number is required.', 400);
    }

    const { mode } = req.body;
    if (mode === 'login' || mode === 'register') {
      const existing = await findExistingVisitorByPhone(phone);
      const isRegistered = !!(existing && existing.visitor_name);
      if (mode === 'login' && !isRegistered) {
        return sendError(res, 'This mobile number is not registered. Please register as a new visitor.', 404);
      }
      if (mode === 'register' && isRegistered) {
        return sendError(res, 'This mobile number is already registered. Please login instead.', 409);
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      const sent = await sendDevPhoneCode(phone);
      if (sent.status === 'cooldown') {
        // Valid code already in flight — not an error, frontend can proceed to OTP entry
        return sendSuccess(res, { cooldown: true }, 'Development mode: a code was already sent. Use the previous OTP.', 200);
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
      // A valid code is already in flight — tell the frontend so it can proceed to the OTP entry step
      return sendSuccess(res, { cooldown: true }, 'A code was sent recently. Please use the code already sent to your email.', 200);
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

// ── Verify Email OTP ──────────────────────────────────────────────────────────
const verifyEmailOtp = async (req, res) => {
  try {
    const { email, otp, visitor_name, visitor_phone, visitor_address, phone_token } = req.body;

    if (!email || !otp) return sendError(res, 'email and otp are required.', 400);

    const cleanEmail = email.trim().toLowerCase();
    const valid = await checkEmailCode(cleanEmail, otp);
    if (!valid) return sendError(res, 'Invalid or expired OTP. Please try again.', 400);

    const emailToken = jwt.sign(
      { purpose: 'EMAIL_VERIFIED', email: cleanEmail },
      process.env.JWT_SECRET,
      { expiresIn: PHONE_TOKEN_EXPIRY }
    );

    // If caller provided full registration fields, also issue visitorToken
    if (visitor_name && visitor_phone && visitor_address && phone_token) {
      let phoneProof = null;
      try { phoneProof = jwt.verify(phone_token, process.env.JWT_SECRET); } catch {}
      const phone = normalisePhone(visitor_phone);
      if (phoneProof && phoneProof.purpose === 'PHONE_VERIFIED' && phoneProof.phone === phone) {
        const visitorToken = jwt.sign(
          {
            purpose:         'PUBLIC_VISITOR',
            visitor_name:    visitor_name.trim(),
            visitor_phone:   phone,
            visitor_email:   cleanEmail,
            visitor_address: visitor_address.trim(),
            phone_verified:  true,
            email_verified:  true,
          },
          process.env.JWT_SECRET,
          { expiresIn: VISITOR_TOKEN_EXPIRY }
        );

        return sendSuccess(
          res,
          { email_verified: true, email_token: emailToken, visitor_token: visitorToken },
          'Email verified successfully.',
          200
        );
      }
    }

    return sendSuccess(
      res,
      { email_verified: true, email_token: emailToken },
      'Email verified successfully.',
      200
    );
  } catch (err) {
    console.error('[PublicAuth] verifyEmailOtp error:', err.message);
    return sendError(res, 'Failed to verify email OTP.', 500);
  }
};

// ── Verify Existing Visitor Phone OTP & Load Profile ──────────────────────────
/**
 * POST /api/public-auth/existing-visitor-verify
 * Body: { phone, idToken, otp }
 *
 * Verifies the Phone OTP. If valid:
 *  - Checks whether this phone exists in past visit_requests or visitors.
 *  - If found: issues a full PUBLIC_VISITOR token so the visitor can directly
 *    fill the visit details form without re-entering identity details or email OTP.
 *  - If not found: returns found: false along with a phone_token, so the visitor
 *    can complete first-time registration without re-verifying their phone.
 */
const existingVisitorVerify = async (req, res) => {
  try {
    const phone = normalisePhone(req.body.phone);
    const { idToken, otp } = req.body;
    if (phone.length !== 10 || !(idToken || otp)) {
      return sendError(res, 'A valid 10-digit phone number and OTP are required.', 400);
    }

    if (otp) {
      if (!(await checkDevPhoneCode(phone, otp))) {
        return sendError(res, 'Invalid or expired OTP. Please try again.', 400);
      }
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

    const existing = await findExistingVisitorByPhone(phone);

    if (existing && existing.visitor_name) {
      const visitorToken = jwt.sign(
        {
          purpose:         'PUBLIC_VISITOR',
          visitor_name:    existing.visitor_name,
          visitor_phone:   phone,
          visitor_email:   existing.visitor_email || '',
          visitor_address: existing.visitor_address || '',
          phone_verified:  true,
          email_verified:  true,
          is_existing:     true,
        },
        process.env.JWT_SECRET,
        { expiresIn: VISITOR_TOKEN_EXPIRY }
      );

      return sendSuccess(
        res,
        {
          found:          true,
          phone_verified: true,
          phone_token:    phoneToken,
          visitor_token:  visitorToken,
          visitor:        existing,
        },
        `Welcome back, ${existing.visitor_name}!`,
        200
      );
    }

    return sendError(
      res,
      'This mobile number is not registered through this portal. Please register as a new visitor.',
      404
    );
  } catch (err) {
    console.error('[PublicAuth] existingVisitorVerify error:', err.message);
    return sendError(res, 'Failed to verify visitor.', 500);
  }
};

// ── Login with Email OR Phone & Password ──────────────────────────────────────
/**
 * POST /api/public-auth/login
 * Body: { identifier, email, phone, password }
 */
const login = async (req, res) => {
  try {
    const identifier = (req.body.identifier || req.body.email || req.body.phone || '').trim();
    const password = req.body.password;

    if (!identifier) {
      return sendError(res, 'Email address or 10-digit mobile number is required.', 400);
    }
    if (!password) {
      return sendError(res, 'Password is required.', 400);
    }

    const visitor = await findExistingVisitorByIdentifier(identifier);
    if (!visitor) {
      return sendError(
        res,
        'Invalid credentials. If you have not registered through this portal, please register as a new visitor.',
        400
      );
    }

    if (!visitor.password_hash) {
      return sendError(
        res,
        'Your profile does not have a password set yet. Please use "Forgot Password" to verify your identity and set a password.',
        400
      );
    }

    const isMatch = await bcrypt.compare(password, visitor.password_hash);
    if (!isMatch) {
      return sendError(res, 'Invalid email/mobile number or password.', 400);
    }

    const visitorToken = jwt.sign(
      {
        purpose:         'PUBLIC_VISITOR',
        visitor_name:    visitor.visitor_name,
        visitor_phone:   visitor.visitor_phone,
        visitor_email:   visitor.visitor_email,
        visitor_address: visitor.visitor_address || '',
        phone_verified:  true,
        email_verified:  true,
        is_existing:     true,
      },
      process.env.JWT_SECRET,
      { expiresIn: VISITOR_TOKEN_EXPIRY }
    );

    return sendSuccess(
      res,
      {
        visitor_token: visitorToken,
        visitor: {
          visitor_name:    visitor.visitor_name,
          visitor_email:   visitor.visitor_email,
          visitor_phone:   visitor.visitor_phone,
          visitor_address: visitor.visitor_address,
          company_name:    visitor.company_name,
        },
      },
      `Welcome back, ${visitor.visitor_name}!`,
      200
    );
  } catch (err) {
    console.error('[PublicAuth] login error:', err.message);
    return sendError(res, 'Failed to log in.', 500);
  }
};

// ── Register with Password (New Visitor) ──────────────────────────────────────
/**
 * POST /api/public-auth/register-with-password
 * Body: { visitor_name, visitor_phone, visitor_email, visitor_address, company_name, password, phone_token, email_token }
 */
const registerWithPassword = async (req, res) => {
  try {
    const {
      visitor_name,
      visitor_phone,
      visitor_email,
      visitor_address,
      company_name,
      password,
      phone_token,
      email_token,
    } = req.body;

    if (!visitor_name || !visitor_phone || !visitor_email || !visitor_address) {
      return sendError(res, 'All visitor identity fields are required.', 400);
    }
    if (!password) {
      return sendError(res, 'Password is required.', 400);
    }
    if (!phone_token || !email_token) {
      return sendError(res, 'Both phone and email verification proofs are required.', 400);
    }

    const phone = normalisePhone(visitor_phone);
    const email = visitor_email.trim().toLowerCase();

    // Verify phone token
    let phoneProof = null;
    try { phoneProof = jwt.verify(phone_token, process.env.JWT_SECRET); } catch {}
    if (!phoneProof || phoneProof.purpose !== 'PHONE_VERIFIED' || phoneProof.phone !== phone) {
      return sendError(res, 'Mobile verification session expired or invalid. Please verify phone again.', 400);
    }

    // Verify email token
    let emailProof = null;
    try { emailProof = jwt.verify(email_token, process.env.JWT_SECRET); } catch {}
    if (!emailProof || emailProof.purpose !== 'EMAIL_VERIFIED' || emailProof.email !== email) {
      return sendError(res, 'Email verification session expired or invalid. Please verify email again.', 400);
    }

    // Validate password
    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      return sendError(res, pwCheck.errors[0] || 'Password does not meet requirements.', 400);
    }

    // Check if phone or email is already registered with password
    const existing = await findExistingVisitorByPhone(phone);
    if (existing && existing.password_hash) {
      return sendError(res, 'This mobile number is already registered through this portal. Please login instead.', 409);
    }
    const existingEmail = await findExistingVisitorByEmail(email);
    if (existingEmail && existingEmail.password_hash) {
      return sendError(res, 'This email address is already registered through this portal. Please login instead.', 409);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Save into central public_registered_visitors
    try {
      await centralPool.query(
        `INSERT INTO public_registered_visitors (phone, full_name, email, password_hash, address, company_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           full_name     = VALUES(full_name),
           email         = VALUES(email),
           password_hash = VALUES(password_hash),
           address       = VALUES(address),
           company_name  = VALUES(company_name),
           updated_at    = NOW()`,
        [phone, visitor_name.trim(), email, passwordHash, visitor_address.trim(), (company_name || '').trim() || null]
      );
    } catch (dbErr) {
      console.error('[PublicAuth] registerWithPassword save error:', dbErr.message);
      return sendError(res, 'Failed to save registered visitor account.', 500);
    }

    const visitorToken = jwt.sign(
      {
        purpose:         'PUBLIC_VISITOR',
        visitor_name:    visitor_name.trim(),
        visitor_phone:   phone,
        visitor_email:   email,
        visitor_address: visitor_address.trim(),
        phone_verified:  true,
        email_verified:  true,
      },
      process.env.JWT_SECRET,
      { expiresIn: VISITOR_TOKEN_EXPIRY }
    );

    return sendSuccess(
      res,
      {
        visitor_token: visitorToken,
        visitor: {
          visitor_name:    visitor_name.trim(),
          visitor_email:   email,
          visitor_phone:   phone,
          visitor_address: visitor_address.trim(),
          company_name:    (company_name || '').trim(),
        },
      },
      'Account created successfully! You may now submit your visit request.',
      201
    );
  } catch (err) {
    console.error('[PublicAuth] registerWithPassword error:', err.message);
    return sendError(res, 'Failed to complete registration.', 500);
  }
};

// ── Forgot Password: Step 1 (Lookup & Dispatch Phone Code Only) ────────────────
/**
 * POST /api/public-auth/forgot-password/init
 * Body: { phone }   (10-digit registered mobile number)
 *
 * Only sends a phone OTP to reset password.
 */
const forgotPasswordInit = async (req, res) => {
  try {
    const rawPhone = (req.body.phone || req.body.identifier || req.body.mobile || '').trim();
    const phone = normalisePhone(rawPhone);
    if (phone.length !== 10) {
      return sendError(res, 'Valid 10-digit registered mobile number is required.', 400);
    }

    const visitor = await findExistingVisitorByPhone(phone);
    if (!visitor || !visitor.visitor_phone) {
      return sendError(res, 'No registered visitor account found for this mobile number. Please register as a new visitor.', 404);
    }

    const maskedPhone = `+91 ******${phone.slice(-4)}`;

    // In non-production, send Dev Phone code — cooldown silently ignored
    let devPhoneOtp = null;
    if (process.env.NODE_ENV !== 'production') {
      const sentPhone = await sendDevPhoneCode(phone);
      if (sentPhone.code) devPhoneOtp = sentPhone.code;
    }
    // In production, Firebase phone OTP is triggered by the frontend (signInWithPhoneNumber)

    return sendSuccess(
      res,
      {
        email: visitor.visitor_email,
        phone,
        masked_phone: maskedPhone,
        visitor_name: visitor.visitor_name,
        dev_phone_otp: devPhoneOtp,
      },
      `A verification code has been sent to your registered mobile (${maskedPhone}).`,
      200
    );
  } catch (err) {
    console.error('[PublicAuth] forgotPasswordInit error:', err.message);
    return sendError(res, 'Failed to initiate password reset.', 500);
  }
};

// ── Forgot Password: Step 2 (Reset Password with Phone Token Only) ─────────────
/**
 * POST /api/public-auth/forgot-password/reset
 * Body: { phone, phone_token, new_password }
 *
 * Only phone verification is required to reset a password.
 */
const forgotPasswordReset = async (req, res) => {
  try {
    const { phone, phone_token, new_password } = req.body;

    if (!phone || !new_password) {
      return sendError(res, 'Phone and new password are required.', 400);
    }
    if (!phone_token) {
      return sendError(res, 'Phone verification proof is required to reset your password.', 400);
    }

    const cleanPhone = normalisePhone(phone);

    // Verify phone proof
    let phoneProof = null;
    try { phoneProof = jwt.verify(phone_token, process.env.JWT_SECRET); } catch {}
    if (!phoneProof || phoneProof.purpose !== 'PHONE_VERIFIED' || phoneProof.phone !== cleanPhone) {
      return sendError(res, 'Phone verification expired or invalid. Please verify your mobile number again.', 400);
    }

    // Validate new password
    const pwCheck = validatePassword(new_password);
    if (!pwCheck.valid) {
      return sendError(res, pwCheck.errors[0] || 'Password does not meet security requirements.', 400);
    }

    const passwordHash = await bcrypt.hash(new_password, 12);

    // Update password in central table by phone
    const [updateResult] = await centralPool.query(
      `UPDATE public_registered_visitors
       SET password_hash = ?, updated_at = NOW()
       WHERE phone = ?`,
      [passwordHash, cleanPhone]
    );

    if (updateResult.affectedRows === 0) {
      return sendError(res, 'Registered visitor record not found.', 404);
    }

    const visitor = await findExistingVisitorByPhone(cleanPhone);

    const visitorToken = jwt.sign(
      {
        purpose:         'PUBLIC_VISITOR',
        visitor_name:    visitor ? visitor.visitor_name : 'Visitor',
        visitor_phone:   cleanPhone,
        visitor_email:   visitor ? visitor.visitor_email : '',
        visitor_address: visitor ? visitor.visitor_address : '',
        phone_verified:  true,
        email_verified:  true,
        is_existing:     true,
      },
      process.env.JWT_SECRET,
      { expiresIn: VISITOR_TOKEN_EXPIRY }
    );

    return sendSuccess(
      res,
      {
        visitor_token: visitorToken,
        visitor: {
          visitor_name:    visitor ? visitor.visitor_name : '',
          visitor_email:   visitor ? visitor.visitor_email : '',
          visitor_phone:   cleanPhone,
          visitor_address: visitor ? visitor.visitor_address : '',
          company_name:    visitor ? visitor.company_name : '',
        },
      },
      'Password reset successfully! You are now logged in.',
      200
    );
  } catch (err) {
    console.error('[PublicAuth] forgotPasswordReset error:', err.message);
    return sendError(res, 'Failed to reset password.', 500);
  }
};

// ── Helper: Extract & Verify Visitor Auth Token ──────────────────────────────
function extractVisitorToken(req) {
  const header = req.headers['x-visitor-token'] || req.headers['authorization'];
  if (!header) return null;
  if (header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  return header.trim();
}

function verifyVisitorAuth(req) {
  const token = extractVisitorToken(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.purpose !== 'PUBLIC_VISITOR') return null;
    return payload;
  } catch {
    return null;
  }
}

// ── GET /api/public-auth/me ──────────────────────────────────────────────────
const getVisitorProfile = async (req, res) => {
  try {
    const auth = verifyVisitorAuth(req);
    if (!auth) return sendError(res, 'Unauthorized visitor session.', 401);

    const cleanPhone = normalisePhone(auth.visitor_phone);
    const [rows] = await centralPool.query(
      `SELECT id, full_name, email, phone, address, company_name, govt_id_type, govt_id_number, photo_url, created_at, updated_at
       FROM public_registered_visitors
       WHERE phone = ? OR phone = ? OR RIGHT(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', ''), 10) = ?
       LIMIT 1`,
      [cleanPhone, `+91${cleanPhone}`, cleanPhone]
    );

    if (!rows || rows.length === 0) {
      return sendSuccess(res, {
        visitor: {
          full_name: auth.visitor_name,
          email: auth.visitor_email,
          phone: auth.visitor_phone,
          address: auth.visitor_address || '',
          company_name: auth.company_name || '',
          govt_id_type: '',
          govt_id_number: '',
          photo_url: '',
        },
      });
    }

    return sendSuccess(res, { visitor: rows[0] });
  } catch (err) {
    console.error('[PublicAuth] getVisitorProfile error:', err.message);
    return sendError(res, 'Failed to fetch visitor profile.', 500);
  }
};

// ── PUT /api/public-auth/profile ─────────────────────────────────────────────
const updateVisitorProfile = async (req, res) => {
  try {
    const auth = verifyVisitorAuth(req);
    if (!auth) return sendError(res, 'Unauthorized visitor session.', 401);

    const { full_name, address, company_name, govt_id_type, govt_id_number, photo_url } = req.body;
    const cleanPhone = normalisePhone(auth.visitor_phone);

    await centralPool.query(
      `UPDATE public_registered_visitors
       SET full_name      = COALESCE(?, full_name),
           address        = COALESCE(?, address),
           company_name   = COALESCE(?, company_name),
           govt_id_type   = COALESCE(?, govt_id_type),
           govt_id_number = COALESCE(?, govt_id_number),
           photo_url      = COALESCE(?, photo_url),
           updated_at     = NOW()
       WHERE phone = ? OR phone = ? OR RIGHT(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', ''), 10) = ?`,
      [
        full_name !== undefined ? full_name.trim() : null,
        address !== undefined ? address.trim() : null,
        company_name !== undefined ? company_name.trim() : null,
        govt_id_type !== undefined ? govt_id_type.trim() : null,
        govt_id_number !== undefined ? govt_id_number.trim() : null,
        photo_url !== undefined ? photo_url.trim() : null,
        cleanPhone, `+91${cleanPhone}`, cleanPhone,
      ]
    );

    const [rows] = await centralPool.query(
      `SELECT id, full_name, email, phone, address, company_name, govt_id_type, govt_id_number, photo_url, created_at, updated_at
       FROM public_registered_visitors
       WHERE phone = ? OR phone = ? OR RIGHT(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', ''), 10) = ?
       LIMIT 1`,
      [cleanPhone, `+91${cleanPhone}`, cleanPhone]
    );

    const updatedVisitor = rows && rows[0] ? rows[0] : {};
    const visitorToken = jwt.sign(
      {
        purpose:         'PUBLIC_VISITOR',
        visitor_name:    updatedVisitor.full_name || auth.visitor_name,
        visitor_phone:   cleanPhone,
        visitor_email:   updatedVisitor.email || auth.visitor_email,
        visitor_address: updatedVisitor.address || '',
        company_name:    updatedVisitor.company_name || '',
        phone_verified:  true,
        email_verified:  true,
        is_existing:     true,
      },
      process.env.JWT_SECRET,
      { expiresIn: VISITOR_TOKEN_EXPIRY }
    );

    return sendSuccess(res, { visitor: updatedVisitor, visitor_token: visitorToken }, 'Profile updated successfully.');
  } catch (err) {
    console.error('[PublicAuth] updateVisitorProfile error:', err.message);
    return sendError(res, 'Failed to update profile.', 500);
  }
};

// ── GET /api/public-auth/my-requests ─────────────────────────────────────────
const getMyVisitorRequests = async (req, res) => {
  try {
    const auth = verifyVisitorAuth(req);
    if (!auth) return sendError(res, 'Unauthorized visitor session.', 401);

    const cleanPhone = normalisePhone(auth.visitor_phone);
    const cleanEmail = (auth.visitor_email || '').trim().toLowerCase();

    // Pagination params
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 10));
    // Status filter (tab): ALL | APPROVED | PENDING | COMPLETED | REJECTED_CANCELLED
    const statusFilter = (req.query.status || 'ALL').toUpperCase();
    const search       = (req.query.search || '').trim().toLowerCase();

    // Fetch active units
    const [units] = await centralPool.query(
      `SELECT id, name AS unit_name, code AS unit_code, db_name FROM units WHERE is_active = 1 AND db_status = 'ACTIVE'`
    );

    const allRequests = [];

    await Promise.allSettled(
      units.map(async (unit) => {
        try {
          const pool = getPool(unit.db_name);
          const [rows] = await pool.query(
            `SELECT 
              vr.id,
              vr.visitor_name,
              vr.visitor_phone,
              vr.visitor_email,
              vr.visitor_address,
              vr.purpose,
              vr.visit_date,
              vr.visit_start_time,
              vr.visit_end_time,
              vr.status,
              vr.visit_category,
              vr.company_name,
              (SELECT ah.remarks FROM approval_history ah WHERE ah.visit_request_id = vr.id AND ah.action = 'REJECTED' ORDER BY ah.created_at DESC LIMIT 1) AS rejection_reason,
              vr.accompanying_count,
              vr.created_at,
              vr.updated_at,
              vr.unit_id,
              vr.department_id,
              vr.host_user_id,
              h.full_name AS host_name,
              h.email AS host_email,
              h.phone AS host_phone,
              d.name AS department_name,
              gp.id AS gate_pass_id,
              gp.pass_number,
              gp.qr_code_path,
              gp.status AS pass_status,
              gp.issued_at,
              gp.qr_expires_at
            FROM visit_requests vr
            LEFT JOIN users h ON h.id = vr.host_user_id
            LEFT JOIN departments d ON d.id = vr.department_id
            LEFT JOIN gate_passes gp ON gp.visit_request_id = vr.id
            WHERE (
              vr.visitor_phone = ? 
              OR vr.visitor_phone = ? 
              OR RIGHT(REPLACE(REPLACE(REPLACE(COALESCE(vr.visitor_phone, ''), ' ', ''), '-', ''), '+', ''), 10) = ?
              ${cleanEmail ? 'OR LOWER(TRIM(COALESCE(vr.visitor_email, ""))) = ?' : ''}
            )
            ORDER BY vr.visit_date DESC, vr.created_at DESC`,
            cleanEmail
              ? [cleanPhone, `+91${cleanPhone}`, cleanPhone, cleanEmail]
              : [cleanPhone, `+91${cleanPhone}`, cleanPhone]
          );

          for (const row of rows) {
            allRequests.push({
              ...row,
              unit_id: unit.id,
              unit_name: unit.unit_name,
              unit_code: unit.unit_code,
              // QR signed URLs will be generated only for the current page later
              _qr_path: row.qr_code_path || null,
            });
          }
        } catch (unitErr) {
          console.error(`[PublicAuth] Failed querying unit ${unit.unit_name}:`, unitErr.message);
        }
      })
    );

    // Sort newest-first across all units
    allRequests.sort((a, b) => new Date(b.created_at || b.visit_date) - new Date(a.created_at || a.visit_date));

    // ── Status counts (for tab badges, computed on full unfiltered set) ────────
    const counts = {
      ALL:                allRequests.length,
      PENDING:            allRequests.filter(r => r.status === 'PENDING').length,
      APPROVED:           allRequests.filter(r => ['APPROVED', 'CHECKED_IN'].includes(r.status)).length,
      COMPLETED:          allRequests.filter(r => r.status === 'COMPLETED').length,
      REJECTED_CANCELLED: allRequests.filter(r => ['REJECTED', 'CANCELLED'].includes(r.status)).length,
    };

    // ── Apply status tab filter ───────────────────────────────────────────────
    let filtered = allRequests;
    if (statusFilter === 'PENDING')            filtered = allRequests.filter(r => r.status === 'PENDING');
    else if (statusFilter === 'APPROVED')      filtered = allRequests.filter(r => ['APPROVED', 'CHECKED_IN'].includes(r.status));
    else if (statusFilter === 'COMPLETED')     filtered = allRequests.filter(r => r.status === 'COMPLETED');
    else if (statusFilter === 'REJECTED_CANCELLED') filtered = allRequests.filter(r => ['REJECTED', 'CANCELLED'].includes(r.status));

    // ── Apply search filter ───────────────────────────────────────────────────
    if (search) {
      filtered = filtered.filter(r =>
        (r.host_name     || '').toLowerCase().includes(search) ||
        (r.department_name || '').toLowerCase().includes(search) ||
        (r.unit_name     || '').toLowerCase().includes(search) ||
        (r.purpose       || '').toLowerCase().includes(search) ||
        (r.pass_number   || '').toLowerCase().includes(search)
      );
    }

    // ── Paginate ──────────────────────────────────────────────────────────────
    const total      = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage   = Math.min(page, totalPages);
    const offset     = (safePage - 1) * limit;
    const pageSlice  = filtered.slice(offset, offset + limit);

    // Generate signed QR URLs only for the current page (avoids N×units S3 calls)
    const requests = await Promise.all(
      pageSlice.map(async (r) => {
        const { _qr_path, ...rest } = r;
        return { ...rest, qr_code_url: _qr_path ? await getSignedFileUrl(_qr_path) : null };
      })
    );

    return sendSuccess(res, {
      requests,
      counts,
      pagination: { page: safePage, limit, total, totalPages },
    });
  } catch (err) {
    console.error('[PublicAuth] getMyVisitorRequests error:', err.message);
    return sendError(res, 'Failed to fetch visit requests.', 500);
  }
};

// ── POST /api/public-auth/cancel-request ─────────────────────────────────────
const cancelMyVisitorRequest = async (req, res) => {
  try {
    const auth = verifyVisitorAuth(req);
    if (!auth) return sendError(res, 'Unauthorized visitor session.', 401);

    const { unit_id, request_id } = req.body;
    if (!unit_id || !request_id) return sendError(res, 'unit_id and request_id are required.', 400);

    const [units] = await centralPool.query(
      `SELECT id, name, db_name FROM units WHERE id = ? AND is_active = 1`,
      [parseInt(unit_id)]
    );
    if (!units || units.length === 0) return sendError(res, 'Unit not found.', 404);

    const pool = getPool(units[0].db_name);
    const cleanPhone = normalisePhone(auth.visitor_phone);
    const cleanEmail = (auth.visitor_email || '').trim().toLowerCase();

    // Verify ownership and status — fetch full details for notifications
    const [rows] = await pool.query(
      `SELECT vr.id, vr.status, vr.visitor_name, vr.visitor_phone, vr.visitor_email,
              vr.visit_date, vr.visit_start_time, vr.purpose,
              h.id AS host_id, h.full_name AS host_name, h.email AS host_email, h.phone AS host_phone,
              d.name AS department_name
       FROM visit_requests vr
       LEFT JOIN users h ON h.id = vr.host_user_id
       LEFT JOIN departments d ON d.id = vr.department_id
       WHERE vr.id = ?`,
      [parseInt(request_id)]
    );
    if (!rows || rows.length === 0) return sendError(res, 'Visit request not found.', 404);

    const reqRow = rows[0];
    const isOwner = (normalisePhone(reqRow.visitor_phone) === cleanPhone) ||
                    (cleanEmail && reqRow.visitor_email && reqRow.visitor_email.trim().toLowerCase() === cleanEmail);

    if (!isOwner) return sendError(res, 'Access denied.', 403);
    if (reqRow.status !== 'PENDING') {
      return sendError(res, `Cannot cancel a request that is already ${reqRow.status.toLowerCase()}.`, 400);
    }

    await pool.query(
      `UPDATE visit_requests SET status = 'CANCELLED', updated_at = NOW() WHERE id = ?`,
      [parseInt(request_id)]
    );

    // ── Notifications (fire-and-forget, don't block response) ─────────────────
    const visitorName = reqRow.visitor_name || auth.visitor_name || 'Visitor';
    const visitDate   = reqRow.visit_date || '';
    const timeStr     = reqRow.visit_start_time ? ` at ${reqRow.visit_start_time}` : '';
    const unitDb      = units[0].db_name;

    setImmediate(async () => {
      try {
        // 1. Confirm cancellation to the VISITOR (email + SMS)
        if (reqRow.visitor_email) {
          await sendNotification({
            db: pool, visitRequestId: parseInt(request_id),
            recipientEmail: reqRow.visitor_email,
            type: 'EMAIL',
            subject: `Visit Request Cancelled – OHPC VMS`,
            message: emailService.visitCancelledVisitorTemplate
              ? emailService.visitCancelledVisitorTemplate(visitorName, reqRow.host_name, visitDate, reqRow.purpose)
              : `<p>Hi ${visitorName},</p><p>Your visit request to <strong>${reqRow.host_name || 'your host'}</strong> scheduled for <strong>${visitDate}${timeStr}</strong> (Purpose: ${reqRow.purpose || 'N/A'}) has been <strong>cancelled</strong> as requested by you.</p><p>You may schedule a new request at any time.</p>`,
          });
        }
        if (reqRow.visitor_phone || auth.visitor_phone) {
          await sendNotification({
            db: pool, visitRequestId: parseInt(request_id),
            recipientPhone: reqRow.visitor_phone || auth.visitor_phone,
            type: 'SMS',
            message: `OHPC VMS: Your visit to ${reqRow.host_name || 'your host'} on ${visitDate}${timeStr} has been cancelled as requested. You may book a new visit anytime.`,
          });
        }

        // 2. Notify HOST that visitor cancelled (email + SMS + dashboard)
        if (reqRow.host_id) {
          if (reqRow.host_email) {
            await sendNotification({
              db: pool, visitRequestId: parseInt(request_id),
              recipientUserId: reqRow.host_id,
              recipientEmail: reqRow.host_email,
              type: 'EMAIL',
              subject: `Visit Cancelled by Visitor – OHPC VMS`,
              message: emailService.visitCancelledToHostTemplate
                ? emailService.visitCancelledToHostTemplate(reqRow.host_name, visitorName, visitDate, 'visitor')
                : `<p>Hi ${reqRow.host_name || 'there'},</p><p><strong>${visitorName}</strong> has cancelled their visit request scheduled for <strong>${visitDate}${timeStr}</strong>.</p><p>No further action is required from your side.</p>`,
            });
          }
          if (reqRow.host_phone) {
            await sendNotification({
              db: pool, visitRequestId: parseInt(request_id),
              recipientUserId: reqRow.host_id,
              recipientPhone: reqRow.host_phone,
              type: 'SMS',
              message: `OHPC VMS: ${visitorName} has cancelled their visit to you scheduled for ${visitDate}${timeStr}. No action required.`,
            });
          }
          await sendNotification({
            db: pool, visitRequestId: parseInt(request_id),
            recipientUserId: reqRow.host_id,
            type: 'DASHBOARD',
            message: `${visitorName} cancelled their visit request for ${visitDate}${timeStr}.`,
          });
        }
      } catch (notifyErr) {
        console.error('[PublicAuth] cancelMyVisitorRequest notification error:', notifyErr.message);
      }
    });

    return sendSuccess(res, null, 'Visit request cancelled successfully.');
  } catch (err) {
    console.error('[PublicAuth] cancelMyVisitorRequest error:', err.message);
    return sendError(res, 'Failed to cancel request.', 500);
  }
};

// ── GET /api/public-auth/pass/:unitId/:passNumber ───────────────────────────
const getVisitorPass = async (req, res) => {
  try {
    const auth = verifyVisitorAuth(req);
    if (!auth) return sendError(res, 'Unauthorized visitor session.', 401);

    const { unitId, passNumber } = req.params;
    if (!unitId || !passNumber) return sendError(res, 'unitId and passNumber are required.', 400);

    const [units] = await centralPool.query(
      `SELECT id, name, code, db_name FROM units WHERE id = ? AND is_active = 1`,
      [parseInt(unitId)]
    );
    if (!units || units.length === 0) return sendError(res, 'Unit not found.', 404);

    const pool = getPool(units[0].db_name);
    const cleanPhone = normalisePhone(auth.visitor_phone);
    const cleanEmail = (auth.visitor_email || '').trim().toLowerCase();

    const [rows] = await pool.query(
      `SELECT gp.*,
              vr.visit_date, vr.visit_start_time, vr.visit_end_time,
              vr.purpose, vr.status AS request_status, vr.visit_category,
              vr.visitor_name, vr.visitor_phone, vr.visitor_email, vr.company_name,
              vr.accompanying_count,
              h.full_name AS host_name,
              h.email AS host_email,
              h.phone AS host_phone,
              d.name AS department_name
       FROM gate_passes gp
       JOIN visit_requests vr ON vr.id = gp.visit_request_id
       LEFT JOIN users h ON h.id = vr.host_user_id
       LEFT JOIN departments d ON d.id = vr.department_id
       WHERE gp.pass_number = ?`,
      [passNumber]
    );

    if (!rows || rows.length === 0) return sendError(res, 'Gate pass not found.', 404);

    const pass = rows[0];
    const isOwner = (normalisePhone(pass.visitor_phone) === cleanPhone) ||
                    (cleanEmail && pass.visitor_email && pass.visitor_email.trim().toLowerCase() === cleanEmail);

    if (!isOwner) return sendError(res, 'Access denied.', 403);

    const qrUrl = pass.qr_code_path ? await getSignedFileUrl(pass.qr_code_path) : null;

    return sendSuccess(res, {
      pass: {
        ...pass,
        unit_name: units[0].name,
        unit_code: units[0].code,
        qr_code_url: qrUrl,
      },
    });
  } catch (err) {
    console.error('[PublicAuth] getVisitorPass error:', err.message);
    return sendError(res, 'Failed to fetch gate pass.', 500);
  }
};

module.exports = {
  checkPhone,
  checkEmail,
  sendPhoneOtp,
  verifyFirebasePhone,
  sendEmailOtp,
  verifyEmailOtp,
  existingVisitorVerify,
  login,
  registerWithPassword,
  forgotPasswordInit,
  forgotPasswordReset,
  getVisitorProfile,
  updateVisitorProfile,
  getMyVisitorRequests,
  cancelMyVisitorRequest,
  getVisitorPass,
};
