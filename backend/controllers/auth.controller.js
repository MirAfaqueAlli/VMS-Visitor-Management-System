// backend/controllers/auth.controller.js
'use strict';

const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const { sendSuccess, sendError } = require('../utils/response.util');
const { logAudit }               = require('../utils/auditLogger.util');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sanitizeUser = (user) => ({
  id:              user.id,
  full_name:       user.full_name,
  email:           user.email,
  phone:           user.phone,
  designation:     user.designation,
  employee_code:   user.employee_code,
  role:            user.role_type,         // expose as "role" for frontend compat
  role_type:       user.role_type,         // also expose directly
  organization_id: user.organization_id,
  department_id:   user.department_id,     // null for org_admin
  organization_name: user.organization_name || null,
  department_name:   user.department_name  || null,
  last_login_at:   user.last_login_at,
  // Convenience flags
  is_org_admin:    user.role_type === 'org_admin',
  is_dept_admin:   user.role_type === 'dept_admin',
});

// ─── Login ────────────────────────────────────────────────────────────────────

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const [rows] = await db.query(
      `SELECT u.id, u.organization_id, u.department_id,
              u.employee_code, u.full_name, u.email, u.phone,
              u.designation, u.password_hash, u.is_active,
              u.last_login_at, u.role_type,
              o.name AS organization_name,
              d.name AS department_name
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.email = ? AND u.is_active = 1 AND u.deleted_at IS NULL`,
      [email]
    );

    if (rows.length === 0) return sendError(res, 'Invalid credentials.', 401);

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) return sendError(res, 'Invalid credentials.', 401);

    const payload = { userId: user.id, role: user.role_type };
    const token   = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    });

    db.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id])
      .catch(err => console.error('[AuthController] last_login_at update failed:', err.message));

    await logAudit({
      userId: user.id, action: 'LOGIN', module: 'AUTH',
      recordType: 'USER', recordId: user.id,
      ipAddress: req.ip, userAgent: req.headers['user-agent'] || null,
    });

    return sendSuccess(res, { token, user: sanitizeUser(user) }, 'Login successful.', 200);
  } catch (err) {
    console.error('[AuthController] login error:', err.message);
    return sendError(res, 'Login failed due to a server error.', 500);
  }
};

// ─── Register Organization ────────────────────────────────────────────────────
/**
 * POST /api/auth/register-org  (public — no JWT required)
 *
 * Body:
 *   org:   { name, code, type, city, state, phone, email }
 *   admin: { full_name, email, phone, password, employee_code, designation? }
 *
 * Creates the organization + the first org_admin user in one transaction,
 * then returns a JWT so the admin can start using the system immediately.
 */
const registerOrg = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { org, admin } = req.body;

    if (!org || !admin) {
      return sendError(res, 'org and admin objects are required.', 400);
    }

    const { name, code, type, city, state, phone: orgPhone, email: orgEmail } = org;
    const { full_name, email, phone, password, employee_code, designation } = admin;

    if (!name || !code || !full_name || !email || !phone || !password || !employee_code) {
      return sendError(res, 'Missing required fields in org or admin.', 400);
    }

    // Check org code uniqueness
    const [existingOrg] = await conn.query(
      `SELECT id FROM organizations WHERE code = ? LIMIT 1`, [code]
    );
    if (existingOrg.length > 0) {
      conn.release();
      return sendError(res, 'An organization with this code already exists.', 409);
    }

    // Check admin email uniqueness
    const [existingUser] = await conn.query(
      `SELECT id FROM users WHERE email = ? OR phone = ? LIMIT 1`,
      [email, phone]
    );
    if (existingUser.length > 0) {
      conn.release();
      return sendError(res, 'A user with this email or phone already exists.', 409);
    }

    await conn.beginTransaction();

    // 1. Create organization
    const [orgResult] = await conn.query(
      `INSERT INTO organizations (name, code, type, city, state, phone, email, is_active, setup_complete, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, FALSE, NOW(), NOW())`,
      [name, code, type || null, city || null, state || null, orgPhone || null, orgEmail || null]
    );
    const organizationId = orgResult.insertId;

    // 2. Hash password
    const password_hash = await bcrypt.hash(password, 12);

    // 3. Create org_admin user (department_id = NULL for org_admin)
    const [userResult] = await conn.query(
      `INSERT INTO users (organization_id, department_id, role_type, full_name, email, phone,
                          password_hash, employee_code, designation, is_active, created_at, updated_at)
       VALUES (?, NULL, 'org_admin', ?, ?, ?, ?, ?, ?, TRUE, NOW(), NOW())`,
      [organizationId, full_name, email, phone, password_hash, employee_code, designation || null]
    );
    const userId = userResult.insertId;

    await conn.commit();
    conn.release();

    // 4. Issue JWT immediately
    const payload = { userId, role: 'org_admin' };
    const token   = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    });

    const newUser = {
      id: userId, full_name, email, phone, designation: designation || null,
      employee_code, role_type: 'org_admin', organization_id: organizationId,
      department_id: null, organization_name: name, department_name: null,
      last_login_at: null, is_org_admin: true, is_dept_admin: false,
    };

    await logAudit({
      userId, action: 'REGISTER_ORG', module: 'AUTH',
      recordType: 'ORGANIZATION', recordId: organizationId,
      newValues: { org_name: name, org_code: code },
      ipAddress: req.ip, userAgent: req.headers['user-agent'] || null,
    });

    return sendSuccess(
      res,
      { token, user: sanitizeUser(newUser), organization_id: organizationId },
      'Organization registered successfully.',
      201
    );
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    conn.release();
    console.error('[AuthController] registerOrg error:', err.message);
    return sendError(res, 'Failed to register organization.', 500);
  }
};

// ─── Get Me ───────────────────────────────────────────────────────────────────

const getMe = async (req, res) => {
  try {
    // Re-fetch with org + dept names
    const [rows] = await db.query(
      `SELECT u.*, o.name AS organization_name, d.name AS department_name
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.id = ?`,
      [req.user.id]
    );
    if (!rows.length) return sendError(res, 'User not found.', 404);
    return sendSuccess(res, sanitizeUser(rows[0]), 'User profile retrieved successfully.', 200);
  } catch (err) {
    console.error('[AuthController] getMe error:', err.message);
    return sendError(res, 'Failed to retrieve user profile.', 500);
  }
};

// ─── Change Password ──────────────────────────────────────────────────────────

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    const [rows] = await db.query(
      'SELECT id, password_hash FROM users WHERE id = ? AND is_active = 1 AND deleted_at IS NULL',
      [userId]
    );
    if (rows.length === 0) return sendError(res, 'User not found or account is inactive.', 404);

    const isMatch = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!isMatch) return sendError(res, 'Current password is incorrect.', 400);

    const newHash = await bcrypt.hash(newPassword, 12);
    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId]);

    await logAudit({
      userId, action: 'CHANGE_PASSWORD', module: 'AUTH',
      recordType: 'USER', recordId: userId,
      ipAddress: req.ip, userAgent: req.headers['user-agent'] || null,
    });

    return sendSuccess(res, null, 'Password changed successfully.', 200);
  } catch (err) {
    console.error('[AuthController] changePassword error:', err.message);
    return sendError(res, 'Password change failed due to a server error.', 500);
  }
};

module.exports = { login, registerOrg, getMe, changePassword };
