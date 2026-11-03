// backend/controllers/visitorPortal.controller.js
'use strict';

/**
 * Visitor portal — accounts for public visitors (vms_central.visitor_accounts).
 *
 * Sign-in:
 *   1. POST /identify          { identifier }            → is there an account / a known visitor?
 *   2a. POST /login            { identifier, password }  → session   (mobile or email + password)
 *   2b. POST /login/otp        { phone, idToken | otp }  → session   (mobile OTP; also creates the
 *                                 account for a visitor staff added, from their unit records)
 *                                                       → { status: 'new', phone_token } otherwise
 *   3. POST /register/check    { phone?, email? }        → already used? (before any code is sent)
 *      POST /register          { full_name, phone, email, address, password,
 *                                phone_token, email_otp } → session
 *
 * Session (header X-Visitor-Session, JWT purpose VISITOR_SESSION):
 *   GET  /me                    profile + what still needs verifying
 *   PUT  /me                    name / address
 *   POST /me/email/send|verify  link or change the email (OTP)
 *   POST /me/phone/verify       confirm the mobile (OTP) if it isn't yet
 *   POST /me/password           set / change the password
 *   GET  /me/visits             every request in every unit, with pass + gate status
 *   GET  /me/visits/:unitId/:id/pass   the gate pass with a fresh QR
 *   POST /me/visits/:unitId/:id/cancel cancel a request still waiting for approval
 *   POST /me/visitor-token      short-lived token for POST /visit-requests/public
 *
 * Mobile OTPs use the same Firebase / development codes as the public form; email
 * codes come from POST /public-auth/send-email-otp (register) or /me/email/send.
 */

const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const QRCode  = require('qrcode');
const {
  normalisePhone, sendEmailCode, checkEmailCode, checkFirebasePhone, checkDevPhoneCode,
} = require('../services/contactVerification.service');
const { findExistingVisitorByPhone } = require('../services/visitorDirectory.service');
const { centralPool, getPool } = require('../services/dbManager');
const { validatePassword } = require('../utils/passwordValidator.util');
const { signQRPayload } = require('../utils/qrToken.util');
const { sendSuccess, sendError } = require('../utils/response.util');
const { sendNotification } = require('../services/notification.service');
const { escapeHtml: esc, noticeMessage } = require('../services/email.service');
const { whatsappText, visitorPortalUrl } = require('../services/whatsapp.service');

const SESSION_EXPIRY       = '12h';
const VISITOR_TOKEN_EXPIRY = '30m';
const PHONE_TOKEN_EXPIRY   = '30m';
const MAX_FAILED_LOGINS    = 5;
const LOCK_MINUTES         = 15;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isEmail  = (v) => EMAIL_RE.test(String(v || '').trim());
const cleanEmail = (v) => String(v || '').trim().toLowerCase();
/** Email codes for the portal are stored under their own key (never clash with the public form). */
const emailKey = (accountId, email) => `portal:${accountId}:${cleanEmail(email)}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

const ACCOUNT_FIELDS = `id, phone, email, full_name, address, password_hash, phone_verified_at,
  email_verified_at, failed_logins, locked_until, password_changed_at, last_login_at, is_active, created_at`;

async function accountBy(field, value) {
  const [rows] = await centralPool.query(
    `SELECT ${ACCOUNT_FIELDS} FROM visitor_accounts WHERE ${field} = ? LIMIT 1`, [value]
  );
  return rows[0] || null;
}

/** What the browser may see about an account (never the hash or lock counters). */
function publicProfile(a) {
  return {
    id:             a.id,
    full_name:      a.full_name,
    phone:          a.phone,
    email:          a.email,
    address:        a.address,
    phone_verified: !!a.phone_verified_at,
    email_verified: !!(a.email && a.email_verified_at),
    has_password:   !!a.password_hash,
    created_at:     a.created_at,
  };
}

/** Steps the visitor must finish before using the portal (in this order). */
function pendingSteps(a) {
  const steps = [];
  if (!a.phone_verified_at) steps.push('verify_phone');
  if (!a.email) steps.push('add_email');
  else if (!a.email_verified_at) steps.push('verify_email');
  return steps;
}

/** Changes whenever the password is set or changed (compared as read from the DB, so no clock skew). */
const passwordVersion = (a) => (a.password_changed_at ? new Date(a.password_changed_at).getTime() : 0);

async function issueSession(res, account, message) {
  await centralPool.query(
    'UPDATE visitor_accounts SET last_login_at = NOW(), failed_logins = 0, locked_until = NULL WHERE id = ?',
    [account.id]
  );
  // pwv = the password version this session was issued under; a password change makes it stale
  const token = jwt.sign(
    { purpose: 'VISITOR_SESSION', aid: account.id, pwv: passwordVersion(account) },
    process.env.JWT_SECRET, { expiresIn: SESSION_EXPIRY }
  );
  return sendSuccess(res, {
    session_token: token,
    account:       publicProfile(account),
    pending:       pendingSteps(account),
  }, message, 200);
}

/** Checks a mobile OTP the same way as the public form. @returns {Promise<string|null>} error message or null */
async function checkPhoneOtp(phone, { idToken, otp }) {
  if (otp) {
    return (await checkDevPhoneCode(phone, otp)) ? null : 'Invalid or expired OTP. Please try again.';
  }
  const check = await checkFirebasePhone(idToken, phone);
  if (check === 'invalid')  return 'Phone verification failed. Please try again.';
  if (check === 'mismatch') return 'Phone number mismatch. Please verify the correct number.';
  return null;
}

/** True if another visitor account already uses this email. */
async function emailTaken(email, exceptId = 0) {
  const [rows] = await centralPool.query(
    'SELECT id FROM visitor_accounts WHERE email = ? AND id <> ? LIMIT 1', [cleanEmail(email), exceptId]
  );
  return rows.length > 0;
}

// ── Session middleware ────────────────────────────────────────────────────────

const requireVisitorSession = async (req, res, next) => {
  try {
    const token = req.headers['x-visitor-session'];
    if (!token) return sendError(res, 'Please sign in to the visitor portal.', 401);
    let data;
    try { data = jwt.verify(token, process.env.JWT_SECRET); } catch {
      return sendError(res, 'Your visitor session has expired. Please sign in again.', 401);
    }
    // Staff tokens share JWT_SECRET — only accept visitor sessions here
    if (data.purpose !== 'VISITOR_SESSION' || !data.aid) return sendError(res, 'Please sign in to the visitor portal.', 401);

    const account = await accountBy('id', data.aid);
    if (!account || !account.is_active) return sendError(res, 'This visitor account is not active.', 401);
    // A password change signs out older sessions
    if ((data.pwv ?? 0) !== passwordVersion(account)) {
      return sendError(res, 'Your password was changed. Please sign in again.', 401);
    }
    req.visitorAccount = account;
    next();
  } catch (err) {
    console.error('[VisitorPortal] session error:', err.message);
    return sendError(res, 'Could not check your visitor session.', 500);
  }
};

// ── 1. Identify ───────────────────────────────────────────────────────────────
/**
 * POST /identify { identifier: mobile number or email }
 * → { kind: 'phone'|'email', account: bool, has_password: bool, known_visitor: bool }
 * Tells the sign-in screen which options to offer. Rate limited per IP.
 */
const identify = async (req, res) => {
  try {
    const raw = String(req.body.identifier || '').trim();
    if (isEmail(raw)) {
      const account = await accountBy('email', cleanEmail(raw));
      return sendSuccess(res, {
        kind: 'email', account: !!account, has_password: !!account?.password_hash, known_visitor: !!account,
      }, 'Checked.');
    }
    const phone = normalisePhone(raw);
    if (phone.length !== 10) return sendError(res, 'Enter a 10-digit mobile number or an email address.', 400);

    const account = await accountBy('phone', phone);
    const known = account ? true : !!(await findExistingVisitorByPhone(phone));
    return sendSuccess(res, {
      kind: 'phone', phone, account: !!account, has_password: !!account?.password_hash, known_visitor: known,
    }, 'Checked.');
  } catch (err) {
    console.error('[VisitorPortal] identify error:', err.message);
    return sendError(res, 'Could not check this account. Please try again.', 500);
  }
};

// ── 2a. Password sign-in ──────────────────────────────────────────────────────
const login = async (req, res) => {
  try {
    const raw = String(req.body.identifier || '').trim();
    const { password } = req.body;
    if (!raw || !password) return sendError(res, 'Enter your mobile number or email, and your password.', 400);

    const account = isEmail(raw) ? await accountBy('email', cleanEmail(raw)) : await accountBy('phone', normalisePhone(raw));
    // Same answer for "no account" and "wrong password"
    const fail = () => sendError(res, 'The mobile number / email or password is incorrect.', 400);
    if (!account || !account.is_active || !account.password_hash) return fail();

    if (account.locked_until && new Date(account.locked_until) > new Date()) {
      return sendError(res, `Too many wrong passwords. Try again after ${LOCK_MINUTES} minutes, or sign in with a mobile OTP.`, 429);
    }

    const ok = await bcrypt.compare(password, account.password_hash);
    if (!ok) {
      await centralPool.query(
        `UPDATE visitor_accounts
            SET failed_logins = failed_logins + 1,
                locked_until  = IF(failed_logins + 1 >= ?, NOW() + INTERVAL ? MINUTE, locked_until)
          WHERE id = ?`,
        [MAX_FAILED_LOGINS, LOCK_MINUTES, account.id]
      );
      return fail();
    }
    return issueSession(res, account, `Welcome back, ${account.full_name}.`);
  } catch (err) {
    console.error('[VisitorPortal] login error:', err.message);
    return sendError(res, 'Could not sign you in. Please try again.', 500);
  }
};

// ── 2b. Mobile OTP sign-in ────────────────────────────────────────────────────
const loginWithOtp = async (req, res) => {
  try {
    const phone = normalisePhone(req.body.phone);
    if (phone.length !== 10) return sendError(res, 'A valid 10-digit mobile number is required.', 400);
    const otpError = await checkPhoneOtp(phone, req.body);
    if (otpError) return sendError(res, otpError, 400);

    let account = await accountBy('phone', phone);
    if (account) {
      if (!account.is_active) return sendError(res, 'This visitor account is not active.', 403);
      if (!account.phone_verified_at) {
        await centralPool.query('UPDATE visitor_accounts SET phone_verified_at = NOW() WHERE id = ?', [account.id]);
        account.phone_verified_at = new Date();
      }
      return issueSession(res, account, `Welcome back, ${account.full_name}.`);
    }

    // A visitor staff registered (or who requested before accounts existed):
    // create the account from their latest record. The email isn't verified yet.
    const known = await findExistingVisitorByPhone(phone);
    if (known?.visitor_name) {
      const email = isEmail(known.visitor_email) && !(await emailTaken(known.visitor_email)) ? cleanEmail(known.visitor_email) : null;
      const [r] = await centralPool.query(
        `INSERT INTO visitor_accounts (phone, email, full_name, address, phone_verified_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [phone, email, known.visitor_name.slice(0, 100), (known.visitor_address || '').slice(0, 255) || null]
      );
      account = await accountBy('id', r.insertId);
      return issueSession(res, account, `Welcome, ${account.full_name}.`);
    }

    // Nobody with this number yet → registration, without verifying the phone again
    const phoneToken = jwt.sign({ purpose: 'PHONE_VERIFIED', phone }, process.env.JWT_SECRET, { expiresIn: PHONE_TOKEN_EXPIRY });
    return sendSuccess(res, { status: 'new', phone, phone_token: phoneToken }, 'Mobile verified. Create your account to continue.');
  } catch (err) {
    console.error('[VisitorPortal] loginWithOtp error:', err.message);
    return sendError(res, 'Could not sign you in. Please try again.', 500);
  }
};

// ── 3. Register ───────────────────────────────────────────────────────────────
/**
 * POST /register/check { phone?, email? }
 * → { phone_account, known_visitor, email_account }
 * The registration form checks the mobile and email as they're typed, so a visitor
 * who already has an account is sent to sign in before any code is sent. A number
 * staff registered at the gate (known_visitor) may still register — visits are
 * matched by mobile, so the earlier ones show in the new account.
 * Says no more than /identify does; rate limited per IP.
 */
const checkRegistration = async (req, res) => {
  try {
    const phone = normalisePhone(req.body.phone);
    const email = cleanEmail(req.body.email);
    const out = { phone_account: false, known_visitor: false, email_account: false };
    if (phone.length === 10) {
      out.phone_account = !!(await accountBy('phone', phone));
      out.known_visitor = !out.phone_account && !!(await findExistingVisitorByPhone(phone));
    }
    if (isEmail(email)) out.email_account = await emailTaken(email);
    return sendSuccess(res, out, 'Checked.');
  } catch (err) {
    console.error('[VisitorPortal] checkRegistration error:', err.message);
    return sendError(res, 'Could not check these details. Please try again.', 500);
  }
};

const register = async (req, res) => {
  try {
    const { full_name, address, password, phone_token, email_otp } = req.body;
    const phone = normalisePhone(req.body.phone);
    const email = cleanEmail(req.body.email);

    if (!full_name?.trim() || phone.length !== 10 || !isEmail(email) || !address?.trim()) {
      return sendError(res, 'Name, mobile number, email and address are required.', 400);
    }
    const { valid, errors } = validatePassword(password || '');
    if (!valid) return sendError(res, errors[0], 400);

    // The mobile must have been verified by OTP (phone_token from /login/otp or /public-auth)
    let proof = null;
    try { proof = jwt.verify(phone_token, process.env.JWT_SECRET); } catch { /* expired / invalid */ }
    if (!proof || proof.purpose !== 'PHONE_VERIFIED' || proof.phone !== phone) {
      return sendError(res, 'Please verify your mobile number first.', 400);
    }

    if (await accountBy('phone', phone)) return sendError(res, 'An account already exists for this mobile number. Please sign in.', 409);
    if (await emailTaken(email)) return sendError(res, 'An account already exists for this email. Please sign in, or use a different email.', 409);

    // Registration email codes are sent by /public-auth/send-email-otp (keyed by the address)
    if (!(await checkEmailCode(email, email_otp))) return sendError(res, 'Invalid or expired email code. Please try again.', 400);

    const hash = await bcrypt.hash(password, 12);
    const [r] = await centralPool.query(
      `INSERT INTO visitor_accounts
         (phone, email, full_name, address, password_hash, phone_verified_at, email_verified_at, password_changed_at)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW(), NOW())`,
      [phone, email, full_name.trim().slice(0, 100), address.trim().slice(0, 255), hash]
    );
    const account = await accountBy('id', r.insertId);
    return issueSession(res, account, `Welcome, ${account.full_name}. Your account is ready.`);
  } catch (err) {
    console.error('[VisitorPortal] register error:', err.message);
    if (err.code === 'ER_DUP_ENTRY') return sendError(res, 'An account already exists for this mobile number or email.', 409);
    return sendError(res, 'Could not create your account. Please try again.', 500);
  }
};

// ── Session: profile ──────────────────────────────────────────────────────────
const me = (req, res) =>
  sendSuccess(res, { account: publicProfile(req.visitorAccount), pending: pendingSteps(req.visitorAccount) }, 'Profile.');

const updateMe = async (req, res) => {
  try {
    const full_name = String(req.body.full_name ?? '').trim();
    const address   = String(req.body.address ?? '').trim();
    if (full_name.length < 2) return sendError(res, 'Enter your full name.', 400);
    await centralPool.query(
      'UPDATE visitor_accounts SET full_name = ?, address = ? WHERE id = ?',
      [full_name.slice(0, 100), address.slice(0, 255) || null, req.visitorAccount.id]
    );
    const account = await accountBy('id', req.visitorAccount.id);
    return sendSuccess(res, { account: publicProfile(account), pending: pendingSteps(account) }, 'Profile updated.');
  } catch (err) {
    console.error('[VisitorPortal] updateMe error:', err.message);
    return sendError(res, 'Could not update your profile.', 500);
  }
};

const sendEmailVerification = async (req, res) => {
  try {
    const email = cleanEmail(req.body.email);
    if (!isEmail(email)) return sendError(res, 'Enter a valid email address.', 400);
    if (await emailTaken(email, req.visitorAccount.id)) return sendError(res, 'This email is already linked to another visitor account.', 409);

    const sent = await sendEmailCode(email, emailKey(req.visitorAccount.id, email));
    if (sent.status === 'cooldown') return sendError(res, 'A code was sent recently. Please wait 20 seconds.', 429);
    if (sent.status === 'failed') {
      if (!sent.devOtp) return sendError(res, 'Could not send the email. Check the address and try again.', 500);
      return sendSuccess(res, { dev_otp: sent.devOtp }, 'Development mode: email delivery failed, use the code shown.');
    }
    return sendSuccess(res, {}, `We sent a code to ${email}.`);
  } catch (err) {
    console.error('[VisitorPortal] sendEmailVerification error:', err.message);
    return sendError(res, 'Could not send the email code.', 500);
  }
};

const verifyEmail = async (req, res) => {
  try {
    const email = cleanEmail(req.body.email);
    if (!isEmail(email) || !req.body.otp) return sendError(res, 'Email and code are required.', 400);
    if (await emailTaken(email, req.visitorAccount.id)) return sendError(res, 'This email is already linked to another visitor account.', 409);
    if (!(await checkEmailCode(emailKey(req.visitorAccount.id, email), req.body.otp))) {
      return sendError(res, 'Invalid or expired code. Please try again.', 400);
    }
    await centralPool.query(
      'UPDATE visitor_accounts SET email = ?, email_verified_at = NOW() WHERE id = ?', [email, req.visitorAccount.id]
    );
    const account = await accountBy('id', req.visitorAccount.id);
    return sendSuccess(res, { account: publicProfile(account), pending: pendingSteps(account) }, 'Email verified.');
  } catch (err) {
    console.error('[VisitorPortal] verifyEmail error:', err.message);
    if (err.code === 'ER_DUP_ENTRY') return sendError(res, 'This email is already linked to another visitor account.', 409);
    return sendError(res, 'Could not verify the email.', 500);
  }
};

const verifyPhone = async (req, res) => {
  try {
    const otpError = await checkPhoneOtp(req.visitorAccount.phone, req.body);
    if (otpError) return sendError(res, otpError, 400);
    await centralPool.query('UPDATE visitor_accounts SET phone_verified_at = NOW() WHERE id = ?', [req.visitorAccount.id]);
    const account = await accountBy('id', req.visitorAccount.id);
    return sendSuccess(res, { account: publicProfile(account), pending: pendingSteps(account) }, 'Mobile number verified.');
  } catch (err) {
    console.error('[VisitorPortal] verifyPhone error:', err.message);
    return sendError(res, 'Could not verify the mobile number.', 500);
  }
};

const setPassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const account = req.visitorAccount;
    if (account.password_hash) {
      if (!current_password || !(await bcrypt.compare(current_password, account.password_hash))) {
        return sendError(res, 'Your current password is incorrect.', 400);
      }
    }
    const { valid, errors } = validatePassword(new_password || '');
    if (!valid) return sendError(res, errors[0], 400);

    const hash = await bcrypt.hash(new_password, 12);
    await centralPool.query(
      'UPDATE visitor_accounts SET password_hash = ?, password_changed_at = NOW() WHERE id = ?', [hash, account.id]
    );
    // Older sessions are now invalid — hand this browser a fresh one
    const fresh = await accountBy('id', account.id);
    return issueSession(res, fresh, account.password_hash ? 'Password changed.' : 'Password set. You can now sign in with it.');
  } catch (err) {
    console.error('[VisitorPortal] setPassword error:', err.message);
    return sendError(res, 'Could not save the password.', 500);
  }
};

// ── Session: visits across every unit ─────────────────────────────────────────

const PHONE_MATCH = "RIGHT(REGEXP_REPLACE(COALESCE(vr.visitor_phone, v.phone, ''), '[^0-9]', ''), 10) = ?";

const VISITS_SQL = `
  SELECT vr.id, vr.visit_category, vr.request_source, vr.purpose, vr.company_name,
         vr.visit_date, vr.visit_start_time, vr.visit_end_time, vr.status, vr.created_at,
         h.full_name AS host_name, d.name AS department_name,
         gp.pass_number, gp.status AS pass_status,
         vl.check_in_at, vl.check_out_at, vl.status AS gate_status,
         (SELECT ah.remarks FROM approval_history ah
           WHERE ah.visit_request_id = vr.id AND ah.action IN ('REJECTED', 'CANCELLED')
           ORDER BY ah.created_at DESC LIMIT 1) AS decision_remarks
    FROM visit_requests vr
    LEFT JOIN visitors v     ON v.id = vr.visitor_id
    LEFT JOIN users h        ON h.id = vr.host_user_id
    LEFT JOIN departments d  ON d.id = vr.department_id
    LEFT JOIN gate_passes gp ON gp.visit_request_id = vr.id
    LEFT JOIN visit_logs vl  ON vl.id = (SELECT MAX(l.id) FROM visit_logs l WHERE l.visit_request_id = vr.id)
   WHERE ${PHONE_MATCH}
   ORDER BY vr.visit_date DESC, vr.id DESC
   LIMIT 300`;

/** Active units with their database (db_name stays server-side). */
async function activeUnits() {
  const [units] = await centralPool.query(
    `SELECT id, name, city, db_name FROM units WHERE is_active = 1 AND db_status = 'ACTIVE'`
  );
  return units;
}

const myVisits = async (req, res) => {
  try {
    const phone = req.visitorAccount.phone;
    const units = await activeUnits();
    const settled = await Promise.allSettled(units.map(async (u) => {
      const [rows] = await getPool(u.db_name).query(VISITS_SQL, [phone]);
      return rows.map((r) => ({ ...r, unit_id: u.id, unit_name: u.name, unit_city: u.city }));
    }));
    const failed = settled.filter((s) => s.status === 'rejected');
    failed.forEach((f) => console.warn('[VisitorPortal] myVisits unit query failed:', f.reason?.message));

    const visits = settled
      .filter((s) => s.status === 'fulfilled')
      .flatMap((s) => s.value)
      .sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date) || new Date(b.created_at) - new Date(a.created_at));

    return sendSuccess(res, { visits, incomplete: failed.length > 0 }, 'Your visits.');
  } catch (err) {
    console.error('[VisitorPortal] myVisits error:', err.message);
    return sendError(res, 'Could not load your visits.', 500);
  }
};

const myPass = async (req, res) => {
  try {
    const unitId = parseInt(req.params.unitId, 10);
    const id     = parseInt(req.params.id, 10);
    const unit   = (await activeUnits()).find((u) => u.id === unitId);
    if (!unit || !id) return sendError(res, 'Visit not found.', 404);

    const [rows] = await getPool(unit.db_name).query(
      `SELECT vr.id, vr.visit_date, vr.visit_start_time, vr.visit_end_time, vr.status, vr.purpose,
              COALESCE(v.full_name, vr.visitor_name) AS visitor_name,
              h.full_name AS host_name, d.name AS department_name,
              gp.pass_number, gp.status AS pass_status, gp.qr_code_data
         FROM visit_requests vr
         LEFT JOIN visitors v     ON v.id = vr.visitor_id
         LEFT JOIN users h        ON h.id = vr.host_user_id
         LEFT JOIN departments d  ON d.id = vr.department_id
         JOIN gate_passes gp      ON gp.visit_request_id = vr.id
        WHERE vr.id = ? AND ${PHONE_MATCH}
        LIMIT 1`,
      [id, req.visitorAccount.phone]
    );
    if (!rows.length) return sendError(res, 'No gate pass for this visit yet.', 404);
    const p = rows[0];

    // The QR is shown only while the pass can still be used at the gate
    let qr = null;
    if (p.pass_status === 'ISSUED' && p.qr_code_data) {
      try {
        qr = await QRCode.toDataURL(signQRPayload(JSON.parse(p.qr_code_data)), { width: 280, margin: 1, errorCorrectionLevel: 'H' });
      } catch (qrErr) {
        console.warn('[VisitorPortal] QR render failed:', qrErr.message);
      }
    }
    const { qr_code_data: _omit, ...pass } = p;
    return sendSuccess(res, { ...pass, unit_name: unit.name, unit_city: unit.city, qr }, 'Gate pass.');
  } catch (err) {
    console.error('[VisitorPortal] myPass error:', err.message);
    return sendError(res, 'Could not load the gate pass.', 500);
  }
};

/**
 * POST /me/visits/:unitId/:id/cancel — the visitor withdraws a request that is
 * still waiting for approval. The host and the visitor are told (SMS, email,
 * and a dashboard alert for the host).
 */
const cancelVisit = async (req, res) => {
  try {
    const unitId = parseInt(req.params.unitId, 10);
    const id     = parseInt(req.params.id, 10);
    const unit   = (await activeUnits()).find((u) => u.id === unitId);
    if (!unit || !id) return sendError(res, 'Visit not found.', 404);
    const pool = getPool(unit.db_name);

    const [rows] = await pool.query(
      `SELECT vr.id, vr.status, vr.visit_date, vr.visit_start_time, vr.purpose,
              h.id AS host_id, h.full_name AS host_name, h.email AS host_email, h.phone AS host_phone
         FROM visit_requests vr
         LEFT JOIN visitors v ON v.id = vr.visitor_id
         LEFT JOIN users h    ON h.id = vr.host_user_id
        WHERE vr.id = ? AND ${PHONE_MATCH}
        LIMIT 1`,
      [id, req.visitorAccount.phone]
    );
    if (!rows.length) return sendError(res, 'Visit not found.', 404);
    const visit = rows[0];
    if (visit.status !== 'PENDING') {
      return sendError(res, `This request is already ${visit.status.toLowerCase()} and can't be cancelled here. Please contact your host.`, 400);
    }

    // Only a still-pending request flips (guards a host approving at the same moment)
    const [upd] = await pool.query(
      "UPDATE visit_requests SET status = 'CANCELLED', updated_at = NOW() WHERE id = ? AND status = 'PENDING'", [id]
    );
    if (!upd.affectedRows) return sendError(res, 'This request was just reviewed — refresh to see its status.', 409);
    await pool.query(
      `INSERT INTO approval_history (visit_request_id, acted_by_user_id, action, remarks, created_at)
       VALUES (?, ?, 'CANCELLED', 'Cancelled by the visitor.', NOW())`,
      [id, visit.host_id]
    );

    // ── Notifications (fire-and-forget) ──
    const a        = req.visitorAccount;
    const dateStr  = new Date(visit.visit_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
    const when     = `${dateStr}${visit.visit_start_time ? ` at ${String(visit.visit_start_time).slice(0, 5)}` : ''}`;
    const hostName = visit.host_name || 'your host';
    setImmediate(async () => {
      try {
        if (a.email) {
          await sendNotification({
            db: pool, visitRequestId: id, recipientEmail: a.email, type: 'EMAIL',
            ...noticeMessage({
              title: 'Visit request cancelled', name: a.full_name,
              paragraphs: ['Your visit request has been cancelled as you asked. You can request a new visit any time from the visitor portal.'],
              rows: [['To meet', hostName], ['Unit', unit.name], ['Date and time', when]],
              status: { label: 'CANCELLED', tone: 'neutral' },
              cta: { href: visitorPortalUrl(), label: 'Open the visitor portal' },
            }),
          });
        }
        await sendNotification({
          db: pool, visitRequestId: id, recipientPhone: a.phone, type: 'SMS',
          message: `OHPC VMS: Your visit to ${hostName} on ${when} has been cancelled as requested.`,
          whatsappMessage: whatsappText({
            title: 'Visit cancelled', name: a.full_name,
            intro: 'Your visit request has been cancelled as you asked.',
            details: [['To meet', hostName], ['Unit', unit.name], ['Date', when]],
            link: visitorPortalUrl(), linkLabel: 'Request a new visit',
          }),
        });
        if (visit.host_id) {
          if (visit.host_email) {
            await sendNotification({
              db: pool, visitRequestId: id, recipientUserId: visit.host_id, recipientEmail: visit.host_email, type: 'EMAIL',
              ...noticeMessage({
                title: 'Visit cancelled by the visitor', name: visit.host_name,
                paragraphs: [`<strong>${esc(a.full_name)}</strong> has cancelled their visit request. No action is needed from your side.`],
                rows: [['Visitor', a.full_name], ['Date and time', when]],
                status: { label: 'CANCELLED', tone: 'neutral' },
              }),
            });
          }
          if (visit.host_phone) {
            await sendNotification({
              db: pool, visitRequestId: id, recipientUserId: visit.host_id, recipientPhone: visit.host_phone, type: 'SMS',
              message: `OHPC VMS: ${a.full_name} has cancelled their visit to you on ${when}. No action needed.`,
              whatsappMessage: whatsappText({
                title: 'Visit cancelled by the visitor', name: visit.host_name,
                intro: `${a.full_name} has cancelled their visit request. No action is needed.`,
                details: [['Visitor', a.full_name], ['Date', when]],
              }),
            });
          }
          await sendNotification({
            db: pool, visitRequestId: id, recipientUserId: visit.host_id, type: 'DASHBOARD',
            message: `${a.full_name} cancelled their visit request for ${when}.`,
          });
        }
      } catch (notifyErr) {
        console.error('[VisitorPortal] cancel notification error:', notifyErr.message);
      }
    });

    return sendSuccess(res, { id, unit_id: unitId, status: 'CANCELLED' }, 'Visit request cancelled.');
  } catch (err) {
    console.error('[VisitorPortal] cancelVisit error:', err.message);
    return sendError(res, 'Could not cancel the request. Please try again.', 500);
  }
};

/** Short-lived PUBLIC_VISITOR token so the existing request form can submit for this account. */
const visitorToken = async (req, res) => {
  const a = req.visitorAccount;
  if (pendingSteps(a).length) return sendError(res, 'Verify your mobile number and email first.', 400);
  const token = jwt.sign({
    purpose:         'PUBLIC_VISITOR',
    visitor_name:    a.full_name,
    visitor_phone:   a.phone,
    visitor_email:   a.email,
    visitor_address: a.address || '',
    phone_verified:  true,
    email_verified:  true,
    is_existing:     true,
    account_id:      a.id,
  }, process.env.JWT_SECRET, { expiresIn: VISITOR_TOKEN_EXPIRY });
  return sendSuccess(res, { visitor_token: token }, 'Ready.');
};

module.exports = {
  requireVisitorSession,
  identify, login, loginWithOtp, checkRegistration, register,
  me, updateMe, sendEmailVerification, verifyEmail, verifyPhone, setPassword,
  myVisits, myPass, cancelVisit, visitorToken,
};
