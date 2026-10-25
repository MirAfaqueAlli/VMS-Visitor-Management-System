// backend/controllers/setup.controller.js
'use strict';

const bcrypt = require('bcrypt');
const { validatePassword } = require('../utils/passwordValidator.util');
const jwt    = require('jsonwebtoken');
const { centralPool } = require('../services/dbManager');
const { sendEmailCode, checkEmailCode, checkFirebasePhone } = require('../services/contactVerification.service');
const { sendSuccess, sendError } = require('../utils/response.util');

const ALREADY_DONE = 'System is already initialized. Setup can only run once.';
const PROOF_EXPIRY = '30m';   // how long a verified email / mobile stays good for setup

/** True once an organisation or a super admin exists — setup is then closed for good. */
async function setupClosed() {
  const [[{ orgCount }]] = await centralPool.query(
    'SELECT COUNT(*) AS orgCount FROM organizations'
  );
  const [[{ adminCount }]] = await centralPool.query(
    `SELECT COUNT(*) AS adminCount FROM users WHERE role_type = 'super_admin'`
  );
  return orgCount > 0 || adminCount > 0;
}

// Setup's email codes are stored apart from the public visitor form's
const setupEmailKey = (email) => `setup:${email}`;

/** The decoded proof token if it is valid and for `purpose`, else null. */
const readProof = (token, purpose) => {
  try {
    const proof = jwt.verify(token, process.env.JWT_SECRET);
    return proof.purpose === purpose ? proof : null;
  } catch {
    return null;
  }
};

/** 400 telling the setup page which contact detail has to be verified again. */
const needsVerification = (res, channel, message) =>
  res.status(400).json({ success: false, message, reverify: channel });

// ── GET /api/setup/status ──────────────────────────────────────────────────────
/**
 * Returns { initialized: true/false }
 * initialized = true  → org row AND super_admin user both exist
 * initialized = false → system is fresh, show setup wizard
 */
const getStatus = async (req, res) => {
  try {
    const [[{ orgCount }]] = await centralPool.query(
      'SELECT COUNT(*) AS orgCount FROM organizations'
    );
    const [[{ adminCount }]] = await centralPool.query(
      `SELECT COUNT(*) AS adminCount FROM users WHERE role_type = 'super_admin'`
    );
    const initialized = orgCount > 0 && adminCount > 0;
    return res.json({ initialized });
  } catch (err) {
    console.error('[Setup] getStatus error:', err.message);
    // If tables don't even exist, treat as not initialized
    return res.json({ initialized: false });
  }
};

// ── POST /api/setup ────────────────────────────────────────────────────────────
/**
 * One-time initialization.
 * Body: {
 *   org_name, org_code,          // Organization
 *   org_city?, org_state?,
 *   org_phone?, org_email?,
 *   admin_name, admin_email,     // Super Admin account
 *   admin_phone,                 // 10-digit Indian mobile
 *   admin_password,
 *   admin_employee_code?,
 *   email_token, phone_token,    // proofs from the OTP endpoints below
 * }
 * Guards: fails if org or super_admin already exists, or if the admin's email or
 * mobile wasn't verified by OTP. Runs under a MySQL named lock (see initialize
 * below) so two simultaneous first-run requests can't both pass that check.
 */
const initializeLocked = async (req, res) => {
  try {
    // Guard — already initialized?
    if (await setupClosed()) return sendError(res, ALREADY_DONE, 409);

    const {
      org_name, org_code,
      org_city  = null, org_state  = null,
      org_phone = null, org_email  = null,
      admin_name, admin_email,
      admin_phone,
      admin_password,
      admin_employee_code = 'SA-001',
      email_token, phone_token,
    } = req.body;

    // ── The admin's email and mobile must have been verified by OTP ───────────
    // (both arrive normalised from the schema: lower-case email, 10-digit mobile)
    if (readProof(email_token, 'SETUP_EMAIL_VERIFIED')?.email !== admin_email) {
      return needsVerification(res, 'email', 'Please verify the administrator email address again.');
    }
    if (readProof(phone_token, 'SETUP_PHONE_VERIFIED')?.phone !== admin_phone) {
      return needsVerification(res, 'phone', 'Please verify the administrator mobile number again.');
    }

    // ── Validate ──────────────────────────────────────────────────────────────
    if (!org_name?.trim())        return sendError(res, 'org_name is required.',        400);
    if (!org_code?.trim())        return sendError(res, 'org_code is required.',         400);
    if (!admin_name?.trim())      return sendError(res, 'admin_name is required.',       400);
    if (!admin_email?.trim())     return sendError(res, 'admin_email is required.',      400);
    if (!admin_password?.trim())  return sendError(res, 'admin_password is required.',   400);
    const { valid: pwValid, errors: pwErrors } = validatePassword(admin_password);
    if (!pwValid) return sendError(res, pwErrors[0], 400);

    // ── Create organization ───────────────────────────────────────────────────
    const [orgResult] = await centralPool.query(
      `INSERT INTO organizations (name, code, type, city, state, phone, email, is_active)
       VALUES (?, ?, 'Corporate', ?, ?, ?, ?, 1)`,
      [
        org_name.trim(),
        org_code.toUpperCase().trim(),
        org_city,
        org_state,
        org_phone,
        org_email,
      ]
    );
    const orgId = orgResult.insertId;

    // ── Create super admin ────────────────────────────────────────────────────
    const passwordHash = await bcrypt.hash(admin_password, 12);
    const [userResult] = await centralPool.query(
      `INSERT INTO users
         (role_type, full_name, email, phone, password_hash, employee_code, is_active)
       VALUES ('super_admin', ?, ?, ?, ?, ?, 1)`,
      [
        admin_name.trim(),
        admin_email.toLowerCase().trim(),
        admin_phone,
        passwordHash,
        admin_employee_code.trim(),
      ]
    );

    const adminId = userResult.insertId;
   

    // ── Issue session token so the frontend can auto-login immediately ──────────
    const token = jwt.sign(
      { userId: adminId, role: 'super_admin', unit_db: 'central', auth_time: Math.floor(Date.now() / 1000) },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    const userPayload = {
      id:             adminId,
      full_name:      admin_name.trim(),
      email:          admin_email.toLowerCase().trim(),
      phone:          admin_phone || null,
      designation:    null,
      designation_id: null,
      employee_code:  admin_employee_code.trim(),
      role:           'super_admin',
      role_type:      'super_admin',
      department_id:  null,
      department_name: null,
      unit_id:        null,
      unit_name:      null,
      unit_db:        'central',
      last_login_at:  null,
      is_super_admin:    true,
      is_unit_admin:     false,
      is_dept_admin:     false,
      is_global_auditor: false,
      is_unit_auditor:   false,
    };

    return sendSuccess(res, { token, user: userPayload, org_id: orgId, admin_id: adminId },
      'System initialized successfully. You are now logged in.');

  } catch (err) {
    console.error('[Setup] initialize error:', err.message);
    if (err.code === 'ER_DUP_ENTRY') {
      return sendError(res, 'Organization code or admin email already exists.', 409);
    }
    return sendError(res, 'Initialization failed. Please check system configuration and try again.', 500);
  }
};

// ── POST /api/setup/send-email-otp ────────────────────────────────────────────
/** Body: { email } — emails a 6-digit code to the future super admin. */
const sendEmailOtp = async (req, res) => {
  try {
    if (await setupClosed()) return sendError(res, ALREADY_DONE, 409);

    const { email } = req.body;
    const sent = await sendEmailCode(email, setupEmailKey(email));
    if (sent.status === 'cooldown') {
      return sendError(res, 'A code was sent recently. Please wait 60 seconds before requesting another.', 429);
    }
    if (sent.status === 'failed') {
      if (!sent.devOtp) {
        return sendError(res, 'Could not send the verification email. Please check the address and try again.', 500);
      }
      // DEV / TEST MODE: expose OTP in response body
      return sendSuccess(res, { dev_otp: sent.devOtp },
        'OTP generated (dev mode — email delivery failed). Use the dev_otp value to verify.');
    }
    return sendSuccess(res, {}, 'Verification code sent to the email address.');
  } catch (err) {
    console.error('[Setup] sendEmailOtp error:', err.message);
    return sendError(res, 'Failed to send the verification code.', 500);
  }
};

// ── POST /api/setup/verify-email-otp ──────────────────────────────────────────
/** Body: { email, otp } → { email_token } (proof for POST /api/setup) */
const verifyEmailOtp = async (req, res) => {
  try {
    if (await setupClosed()) return sendError(res, ALREADY_DONE, 409);

    const { email, otp } = req.body;
    if (!(await checkEmailCode(setupEmailKey(email), otp))) {
      return sendError(res, 'Incorrect or expired code. Please try again.', 400);
    }
    const emailToken = jwt.sign({ purpose: 'SETUP_EMAIL_VERIFIED', email }, process.env.JWT_SECRET, { expiresIn: PROOF_EXPIRY });
    return sendSuccess(res, { email_token: emailToken }, 'Email address verified.');
  } catch (err) {
    console.error('[Setup] verifyEmailOtp error:', err.message);
    return sendError(res, 'Failed to verify the code.', 500);
  }
};

// ── POST /api/setup/verify-phone ──────────────────────────────────────────────
/**
 * Body: { phone, idToken } → { phone_token } (proof for POST /api/setup)
 * Firebase sends and checks the SMS code in the browser; idToken is its proof.
 * Errors are 400, not 401 — the frontend treats a 401 as an expired session.
 */
const verifyPhone = async (req, res) => {
  try {
    if (await setupClosed()) return sendError(res, ALREADY_DONE, 409);

    const { phone, idToken } = req.body;
    const check = await checkFirebasePhone(idToken, phone);
    if (check === 'mismatch') return sendError(res, 'That code was for a different mobile number. Please request a new code.', 400);
    if (check !== 'ok')       return sendError(res, 'Mobile verification failed. Please request a new code.', 400);

    const phoneToken = jwt.sign({ purpose: 'SETUP_PHONE_VERIFIED', phone }, process.env.JWT_SECRET, { expiresIn: PROOF_EXPIRY });
    return sendSuccess(res, { phone_token: phoneToken }, 'Mobile number verified.');
  } catch (err) {
    console.error('[Setup] verifyPhone error:', err.message);
    return sendError(res, 'Failed to verify the mobile number.', 500);
  }
};

const initialize = async (req, res) => {
  const lockConn = await centralPool.getConnection();
  try {
    const [[{ locked }]] = await lockConn.query("SELECT GET_LOCK('vms_setup_init', 10) AS locked");
    if (locked !== 1) return sendError(res, 'Setup is already in progress. Please try again.', 409);
    return await initializeLocked(req, res);
  } finally {
    try { await lockConn.query("SELECT RELEASE_LOCK('vms_setup_init')"); } catch (_) { /* lock ends with the session anyway */ }
    lockConn.release();
  }
};

module.exports = { getStatus, initialize, sendEmailOtp, verifyEmailOtp, verifyPhone };
