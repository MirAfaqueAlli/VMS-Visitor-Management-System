// backend/controllers/auth.controller.js
'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { validatePassword } = require('../utils/passwordValidator.util');
const jwt    = require('jsonwebtoken');
const { centralPool, getPool, CENTRAL_DB_NAME } = require('../services/dbManager');
const { sendSuccess, sendError } = require('../utils/response.util');
const { logAudit }               = require('../utils/auditLogger.util');
const { sendEmail, passwordResetTemplate } = require('../services/email.service');

// Password-reset tokens are stored only as SHA-256 hashes
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

// Compared against when the email/phone matches no account (same cost factor as real hashes)
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);

// Purge stale failure counters every 15 minutes
setInterval(() => {
  centralPool.query(
    `DELETE FROM login_failures
     WHERE first_failed_at < NOW() - INTERVAL 1 DAY AND (locked_until IS NULL OR locked_until < NOW())`
  ).catch(err => console.error('[AuthController] login failure cleanup failed:', err.message));
}, 15 * 60 * 1000).unref();

// ── Account lockout (vms_central.login_failures) ──────────────────────────────
// MAX_FAILED_LOGINS wrong passwords within LOGIN_LOCK_MINUTES lock the account for
// LOGIN_LOCK_MINUTES. Counted per identifier (unit scope + email), whether or not
// the account exists, so the lock message can't be used to find real accounts.
// (Per-IP limits live in routes/auth.routes.js.)
const MAX_FAILED_LOGINS  = 5;
const LOGIN_LOCK_MINUTES = 15;

const lockKey = (scope, email) => `${scope}|${String(email).trim().toLowerCase()}`;

/** Minutes left on an active lock, or 0 when not locked. */
async function lockMinutesLeft(key) {
  const [rows] = await centralPool.query(
    `SELECT CEIL(TIMESTAMPDIFF(SECOND, NOW(), locked_until) / 60) AS mins
     FROM login_failures WHERE identifier = ? AND locked_until > NOW()`,
    [key]
  );
  return rows.length ? Math.max(1, Number(rows[0].mins)) : 0;
}

/** Counts a failed attempt. Returns true when this attempt triggered the lock. */
async function recordLoginFailure(key) {
  // Assignments run left to right: failed_count uses the old first_failed_at (window
  // check), locked_until sees the new failed_count
  await centralPool.query(
    `INSERT INTO login_failures (identifier, failed_count, first_failed_at) VALUES (?, 1, NOW())
     ON DUPLICATE KEY UPDATE
       failed_count    = IF(first_failed_at < NOW() - INTERVAL ? MINUTE, 1, failed_count + 1),
       first_failed_at = IF(first_failed_at < NOW() - INTERVAL ? MINUTE, NOW(), first_failed_at),
       locked_until    = IF(failed_count >= ?, NOW() + INTERVAL ? MINUTE, locked_until)`,
    [key, LOGIN_LOCK_MINUTES, LOGIN_LOCK_MINUTES, MAX_FAILED_LOGINS, LOGIN_LOCK_MINUTES]
  );
  const [[row]] = await centralPool.query('SELECT failed_count FROM login_failures WHERE identifier = ?', [key]);
  return Number(row?.failed_count) === MAX_FAILED_LOGINS;
}

const clearLoginFailures = (key) =>
  centralPool.query('DELETE FROM login_failures WHERE identifier = ?', [key]);

// ── Helpers ──────────────────────────────────────────────────────────────────

const sanitizeUser = (user, unitDb = 'central', unitName = null) => ({
  id:             user.id,
  full_name:      user.full_name,
  email:          user.email,
  phone:          user.phone || null,
  designation:    user.designation || null,
  designation_id: user.designation_id || null,
  employee_code:  user.employee_code,
  role:           user.role_type,
  role_type:      user.role_type,
  department_id:  user.department_id || null,
  department_name: user.department_name || null,
  unit_id:        user.unit_id || null,
  unit_name:      unitName || user.unit_name || null,
  unit_db:        unitDb,
  last_login_at:  user.last_login_at,
  // Convenience flags
  is_super_admin:    user.role_type === 'super_admin',
  is_unit_admin:     user.role_type === 'unit_admin',
  is_dept_admin:     user.role_type === 'dept_admin',
  is_global_auditor: user.role_type === 'global_auditor',
  is_unit_auditor:   user.role_type === 'unit_auditor',
});

// ── Login ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/login
 * Body: { email, password, unit_id? | unit_code? }
 *
 * Login flow:
 * 1. Check vms_central.users → super_admin / global_auditor
 * 2. If not found: require unit_id (from dropdown) or legacy unit_code
 *    → look up unit in central → query that unit's DB
 */
const login = async (req, res) => {
  try {
    const { email, password, unit_code } = req.body;
    const unitId = req.body.unit_id ? parseInt(req.body.unit_id) : null;

    if (!email || !password) {
      return sendError(res, 'Email and password are required.', 400);
    }

    let user        = null;
    let unitDb      = 'central';
    let dbPool      = centralPool;
    let unitName    = null;

    // ── Step 1: Check central DB (super_admin / global_auditor) ──────────────
    const [centralRows] = await centralPool.query(
      `SELECT id, role_type, full_name, email, phone, employee_code,
              password_hash, is_active, last_login_at,
              NULL AS department_id, NULL AS department_name,
              NULL AS unit_id, NULL AS designation, NULL AS designation_id
       FROM users
       WHERE (email = ? OR phone = ?) AND deleted_at IS NULL`,
      [email, email]
    );

    if (centralRows.length > 0) {
      user   = centralRows[0];
      unitDb = 'central';
      dbPool = centralPool;
    }

    // ── Step 2: Not in central → search unit DB by unit_id or unit_code ────────
    // With no unit selected ("Central / Global" sign-in) there is nothing more to
    // look up: user stays null and the attempt fails as invalid credentials below.
    if (!user && (unitId || unit_code)) {
      let unitRows;
      if (unitId) {
        [unitRows] = await centralPool.query(
          `SELECT id, name, db_name, db_status FROM units WHERE id = ? AND is_active = 1`,
          [unitId]
        );
      } else {
        [unitRows] = await centralPool.query(
          `SELECT id, name, db_name, db_status FROM units WHERE code = ? AND is_active = 1`,
          [unit_code.toUpperCase().trim()]
        );
      }

      if (unitRows.length === 0) {
        return sendError(res, 'Unit not found. Please select a valid unit.', 404);
      }

      const unit = unitRows[0];

      if (unit.db_status !== 'ACTIVE') {
        return sendError(res, 'This unit database is not active. Please contact the system administrator.', 503);
      }

      unitDb   = unit.db_name;
      dbPool   = getPool(unitDb);
      unitName = unit.name;

      const [unitUserRows] = await dbPool.query(
        `SELECT u.id, u.role_type, u.full_name, u.email, u.phone, u.employee_code,
                u.password_hash, u.is_active, u.last_login_at,
                u.department_id, u.unit_id, u.designation, u.designation_id,
                d.name AS department_name
         FROM users u
         LEFT JOIN departments d ON d.id = u.department_id
         WHERE (u.email = ? OR u.phone = ?) AND u.deleted_at IS NULL`,
        [email, email]
      );

      user = unitUserRows[0] || null;
    }

    // ── Step 3: Account lockout (same for existing and unknown accounts) ──────
    const failureKey = lockKey(unitDb, email);
    const minsLeft   = await lockMinutesLeft(failureKey);
    if (minsLeft) {
      return sendError(res, `Too many failed sign-in attempts. Please try again in ${minsLeft} minute(s).`, 429);
    }

    // ── Step 4: Verify password ───────────────────────────────────────────────
    // Unknown accounts are compared against a dummy hash, so response time doesn't
    // reveal whether the account exists
    const isMatch = await bcrypt.compare(password, user ? user.password_hash : DUMMY_PASSWORD_HASH);
    if (!user || !isMatch) {
      const auditCtx = {
        db: unitDb !== 'central' ? dbPool : null, isSuperAdminAction: unitDb === 'central', sourceUnit: unitDb,
        module: 'AUTH', recordType: 'USER', recordId: user?.id ?? null,
        ipAddress: req.ip, userAgent: req.headers['user-agent'] || null,
      };
      const nowLocked = await recordLoginFailure(failureKey);
      logAudit({ ...auditCtx, action: nowLocked ? 'LOGIN_LOCKOUT' : 'LOGIN_FAILED', newValues: { email } });
      if (nowLocked) {
        return sendError(res, `Too many failed sign-in attempts. Please try again in ${LOGIN_LOCK_MINUTES} minutes.`, 429);
      }
      const unitHint = (!unitId && !unit_code) ? ' If you are unit staff, select your unit / branch above.' : '';
      return sendError(res, `Invalid email or password.${unitHint}`, 401);
    }
    await clearLoginFailures(failureKey);

    // Checked after the password: only someone who knows it learns the account is deactivated
    if (!user.is_active) {
      return sendError(res, 'Your account has been deactivated. Please contact an administrator.', 401);
    }

    // ── Step 4: Issue the session ─────────────────────────────────────────────
    // auth_time = sign-in time, kept across refreshes so a session can't be
    // extended past SESSION_MAX_HOURS (see refresh)
    const payload = { userId: user.id, role: user.role_type, unit_db: unitDb, auth_time: Math.floor(Date.now() / 1000) };
    const token   = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    });

    // Update last_login_at
    dbPool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id])
      .catch(err => console.error('[AuthController] last_login_at update failed:', err.message));

    await logAudit({
      db:                 unitDb !== 'central' ? dbPool : null,
      isSuperAdminAction: unitDb === 'central',
      sourceUnit:         unitDb,
      userId:             user.id,
      action:             'LOGIN',
      module:             'AUTH',
      recordType:         'USER',
      recordId:           user.id,
      ipAddress:          req.ip,
      userAgent:          req.headers['user-agent'] || null,
    });

    return sendSuccess(res, { token, user: sanitizeUser(user, unitDb, unitName) }, 'Login successful.', 200);
  } catch (err) {
    console.error('[AuthController] login error:', err.message);
    return sendError(res, 'Login failed due to a server error.', 500);
  }
};

// ── Get Me ────────────────────────────────────────────────────────────────────

/**
 * GET /api/auth/me
 * Uses req.db (resolved by auth middleware) to re-fetch the user's full profile.
 */
const getMe = async (req, res) => {
  try {
    const isCentral = req.user.unit_db === 'central';
    let rows;

    if (isCentral) {
      // IMPORTANT: always use centralPool here — req.db may be overridden to a
      // unit's pool when the super admin is managing a unit (X-Unit-Id header).
      [rows] = await centralPool.query(
        `SELECT id, role_type, full_name, email, phone, employee_code,
                is_active, last_login_at,
                NULL AS department_id, NULL AS department_name,
                NULL AS unit_id, NULL AS designation, NULL AS designation_id
         FROM users WHERE id = ?`,
        [req.user.id]
      );
    } else {
      [rows] = await req.db.query(
        `SELECT u.id, u.role_type, u.full_name, u.email, u.phone, u.employee_code,
                u.is_active, u.last_login_at, u.department_id, u.unit_id,
                u.designation, u.designation_id, d.name AS department_name
         FROM users u
         LEFT JOIN departments d ON d.id = u.department_id
         WHERE u.id = ?`,
        [req.user.id]
      );
    }

    if (!rows.length) return sendError(res, 'User not found.', 404);

    // Get unit name from central if unit user
    let unitName = null;
    if (!isCentral && rows[0].unit_id) {
      const [uRows] = await centralPool.query(
        'SELECT name FROM units WHERE id = ?', [rows[0].unit_id]
      );
      unitName = uRows[0]?.name || null;
    }

    return sendSuccess(
      res,
      sanitizeUser(rows[0], req.user.unit_db, unitName),
      'User profile retrieved successfully.',
      200
    );
  } catch (err) {
    console.error('[AuthController] getMe error:', err.message);
    return sendError(res, 'Failed to retrieve user profile.', 500);
  }
};

// ── Change Password ───────────────────────────────────────────────────────────

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;
    // Central users always live in centralPool — req.db may be switched to a unit
    // (X-Unit-Id / X-Unit-Db), where this id would belong to a different person
    const db = req.user.unit_db === 'central' ? centralPool : req.db;

    const [rows] = await db.query(
      'SELECT id, password_hash FROM users WHERE id = ? AND is_active = 1 AND deleted_at IS NULL',
      [userId]
    );
    if (rows.length === 0) return sendError(res, 'User not found or account is inactive.', 404);

    const isMatch = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!isMatch) return sendError(res, 'Current password is incorrect.', 400);

    // Enforce password policy
    const { valid, errors } = validatePassword(newPassword);
    if (!valid) return sendError(res, errors[0], 400);

    const newHash = await bcrypt.hash(newPassword, 12);
    // password_changed_at invalidates every older session (auth.middleware). Taken
    // from the Node clock, truncated to seconds, so the fresh token issued below
    // (same clock) is never older than it.
    const changedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    await db.query(
      'UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = NOW() WHERE id = ?',
      [newHash, changedAt, userId]
    );
    const token = jwt.sign(
      { userId, role: req.user.role_type, unit_db: req.user.unit_db, auth_time: req.authTime },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    await logAudit({
      db:                 req.user.unit_db !== 'central' ? db : null,
      isSuperAdminAction: req.user.unit_db === 'central',
      sourceUnit:         req.user.unit_db,
      userId,
      action:             'CHANGE_PASSWORD',
      module:             'AUTH',
      recordType:         'USER',
      recordId:           userId,
      ipAddress:          req.ip,
      userAgent:          req.headers['user-agent'] || null,
    });

    // Other sessions are now signed out; this one continues with the fresh token
    return sendSuccess(res, { token }, 'Password changed successfully.', 200);
  } catch (err) {
    console.error('[AuthController] changePassword error:', err.message);
    return sendError(res, 'Password change failed due to a server error.', 500);
  }
};

// ── Forgot / Reset Password (tender 1.4: password recovery by email) ─────────

const RESET_TOKEN_TTL_MINUTES = 30;

/**
 * POST /api/auth/forgot-password
 * Body: { email, unit_id? }  — unit_id as on the login page (omit for central users)
 * Emails a single-use reset link. Always answers the same way, whether or not
 * the account exists, so it can't be used to discover registered emails.
 */
const forgotPassword = async (req, res) => {
  const genericMessage = 'If an account exists for this email, a password reset link has been sent to it.';
  try {
    const email  = req.body.email.trim();
    const unitId = req.body.unit_id ? parseInt(req.body.unit_id, 10) : null;

    // Same lookup order as login: central users first, then the selected unit
    let user   = null;
    let unitDb = 'central';
    const [centralRows] = await centralPool.query(
      'SELECT id, email, is_active FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1', [email]
    );
    if (centralRows.length > 0) {
      user = centralRows[0];
    } else if (unitId) {
      const [unitRows] = await centralPool.query(
        "SELECT db_name FROM units WHERE id = ? AND is_active = 1 AND db_status = 'ACTIVE' LIMIT 1", [unitId]
      );
      if (unitRows.length > 0) {
        unitDb = unitRows[0].db_name;
        const [rows] = await getPool(unitDb).query(
          'SELECT id, email, is_active FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1', [email]
        );
        user = rows[0] || null;
      }
    }
    if (!user || !user.is_active) return sendSuccess(res, null, genericMessage);

    // Max one email per 60 s per address (silently — same response)
    const [recentRows] = await centralPool.query(
      'SELECT id FROM password_reset_tokens WHERE email = ? AND created_at > NOW() - INTERVAL 60 SECOND LIMIT 1',
      [user.email]
    );
    if (recentRows.length > 0) return sendSuccess(res, null, genericMessage);

    // Only the newest link works; the token itself is only ever in the email
    const resetToken = crypto.randomBytes(32).toString('hex');
    await centralPool.query(
      'UPDATE password_reset_tokens SET is_used = TRUE WHERE user_id = ? AND unit_db = ? AND is_used = FALSE',
      [user.id, unitDb]
    );
    await centralPool.query(
      `INSERT INTO password_reset_tokens (token_hash, user_id, unit_db, email, expires_at)
       VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
      [hashToken(resetToken), user.id, unitDb, user.email, RESET_TOKEN_TTL_MINUTES]
    );

    const resetUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}`;
    const { subject, html } = passwordResetTemplate(resetUrl, RESET_TOKEN_TTL_MINUTES);
    sendEmail({ to: user.email, subject, html }).catch(() => {});
    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n[Auth] 🔑 Dev Mode password reset link for ${user.email}: ${resetUrl}\n`);
    }

    return sendSuccess(res, null, genericMessage);
  } catch (err) {
    console.error('[AuthController] forgotPassword error:', err.message);
    return sendError(res, 'Could not process the request. Please try again.', 500);
  }
};

/**
 * POST /api/auth/reset-password
 * Body: { token, newPassword }
 * Sets the new password, consumes the link, and signs out every existing session.
 * Errors use 400 (not 401) so the frontend's 401 handler doesn't redirect.
 */
const resetPassword = async (req, res) => {
  const invalidLink = 'This reset link is invalid or has expired. Please request a new one.';
  try {
    const { token, newPassword } = req.body;

    const [rows] = await centralPool.query(
      `SELECT id, user_id, unit_db, (expires_at < NOW()) AS expired
       FROM password_reset_tokens
       WHERE token_hash = ? AND is_used = FALSE
       LIMIT 1`,
      [hashToken(token)]
    );
    if (rows.length === 0 || rows[0].expired) return sendError(res, invalidLink, 400);

    const { valid, errors } = validatePassword(newPassword);
    if (!valid) return sendError(res, errors[0], 400);

    // Consume the link first (affectedRows guards against using it twice in parallel)
    const [consumed] = await centralPool.query(
      'UPDATE password_reset_tokens SET is_used = TRUE WHERE id = ? AND is_used = FALSE', [rows[0].id]
    );
    if (consumed.affectedRows === 0) return sendError(res, invalidLink, 400);

    const { user_id: userId, unit_db: unitDb } = rows[0];
    const db = unitDb === 'central' ? centralPool : getPool(unitDb);
    const newHash   = await bcrypt.hash(newPassword, 12);
    const changedAt = new Date(Math.floor(Date.now() / 1000) * 1000); // see changePassword
    const [updated] = await db.query(
      `UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = NOW()
       WHERE id = ? AND is_active = 1 AND deleted_at IS NULL`,
      [newHash, changedAt, userId]
    );
    if (updated.affectedRows === 0) return sendError(res, invalidLink, 400);

    await logAudit({
      db:                 unitDb !== 'central' ? db : null,
      isSuperAdminAction: unitDb === 'central',
      sourceUnit:         unitDb,
      userId,
      action:             'RESET_PASSWORD',
      module:             'AUTH',
      recordType:         'USER',
      recordId:           userId,
      ipAddress:          req.ip,
      userAgent:          req.headers['user-agent'] || null,
    });

    return sendSuccess(res, null, 'Your password has been reset. Please sign in with your new password.');
  } catch (err) {
    console.error('[AuthController] resetPassword error:', err.message);
    return sendError(res, 'Password reset failed due to a server error.', 500);
  }
};

// ── Token Refresh ────────────────────────────────────────────────────────────

/**
 * POST /api/auth/refresh
 * Requires a valid (non-expired) JWT via protect middleware.
 * Issues a fresh JWT with the same payload — extends the session for active users,
 * but never beyond SESSION_MAX_HOURS after the original sign-in (default 24 h).
 */
const SESSION_MAX_HOURS = parseInt(process.env.SESSION_MAX_HOURS || '24', 10);

const refresh = async (req, res) => {
  try {
    const sessionAgeSecs = Math.floor(Date.now() / 1000) - req.authTime;
    if (sessionAgeSecs > SESSION_MAX_HOURS * 3600) {
      return sendError(res, 'Your session has reached its maximum length. Please sign in again.', 401);
    }
    const payload = {
      userId:    req.user.id,
      role:      req.user.role_type,
      unit_db:   req.user.unit_db,
      auth_time: req.authTime,
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    });
    return sendSuccess(res, { token }, 'Token refreshed.');
  } catch (err) {
    console.error('[AuthController] refresh error:', err.message);
    return sendError(res, 'Token refresh failed.', 500);
  }
};

module.exports = { login, getMe, changePassword, refresh, forgotPassword, resetPassword };
