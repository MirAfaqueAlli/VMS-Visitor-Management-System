// backend/controllers/auth.controller.js
'use strict';

const bcrypt = require('bcrypt');
const { validatePassword } = require('../utils/passwordValidator.util');
const jwt    = require('jsonwebtoken');
const { centralPool, getPool, CENTRAL_DB_NAME } = require('../services/dbManager');
const { sendSuccess, sendError } = require('../utils/response.util');
const { logAudit }               = require('../utils/auditLogger.util');

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
    let unitName    = null;
    let dbPool      = centralPool;

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
    if (!user) {
      if (!unitId && !unit_code) {
        return sendError(res, 'Please select your unit / branch to sign in.', 400);
      }

      // Find the unit's database name from central
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
      unitName = unit.name;
      dbPool   = getPool(unitDb);

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

      if (unitUserRows.length === 0) {
        return sendError(res, 'Invalid credentials.', 401);
      }

      user = unitUserRows[0];
    }

    // ── Step 3: Verify password ───────────────────────────────────────────────
    if (!user.is_active) {
      return sendError(res, 'Your account has been deactivated. Please contact an administrator.', 401);
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) return sendError(res, 'Invalid credentials.', 401);

    // ── Step 4: Issue JWT with unit_db ────────────────────────────────────────
    const payload = {
      userId:  user.id,
      role:    user.role_type,
      unit_db: unitDb,          // ← key for multi-DB routing in auth.middleware
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    });

    // ── Step 5: Update last_login_at ──────────────────────────────────────────
    dbPool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id])
      .catch(err => console.error('[AuthController] last_login_at update failed:', err.message));

    // ── Step 6: Audit log ─────────────────────────────────────────────────────
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

    return sendSuccess(
      res,
      { token, user: sanitizeUser(user, unitDb, unitName) },
      'Login successful.',
      200
    );
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

    const [rows] = await req.db.query(
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
    await req.db.query('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?', [newHash, userId]);

    await logAudit({
      db:                 req.user.unit_db !== 'central' ? req.db : null,
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

    return sendSuccess(res, null, 'Password changed successfully.', 200);
  } catch (err) {
    console.error('[AuthController] changePassword error:', err.message);
    return sendError(res, 'Password change failed due to a server error.', 500);
  }
};

module.exports = { login, getMe, changePassword };
