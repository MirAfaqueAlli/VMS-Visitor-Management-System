// backend/controllers/user.controller.js
'use strict';

const bcrypt = require('bcrypt');
const db = require('../db');
const { sendSuccess, sendError } = require('../utils/response.util');
const { logAudit } = require('../utils/auditLogger.util');
const { isOrgAdmin, isDeptAdmin } = require('../middlewares/rbac.middleware');

// ── Role helpers ──────────────────────────────────────────────────────────────
const MANAGEABLE_ROLES = ['employee', 'security', 'receptionist'];
const ALL_ROLES        = ['org_admin', 'dept_admin', 'employee', 'security', 'receptionist'];

// ── List Users ────────────────────────────────────────────────────────────────
const listUsers = async (req, res) => {
  try {
    const { role } = req.query;
    const conditions = ['u.deleted_at IS NULL'];
    const params     = [];

    // Dept scoping
    if (!isOrgAdmin(req.user)) {
      if (!isDeptAdmin(req.user)) {
        return sendError(res, 'Access forbidden.', 403);
      }
      conditions.push('u.department_id = ?');
      params.push(req.user.department_id);
    }

    if (role) {
      conditions.push('u.role_type = ?');
      params.push(role);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.designation, u.employee_code,
              u.role_type, u.department_id, u.organization_id, u.is_active, u.created_at,
              d.name AS department_name, o.name AS organization_name
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN organizations o ON o.id = u.organization_id
       ${where}
       ORDER BY u.full_name ASC`,
      params
    );
    return sendSuccess(res, rows, 'Users fetched successfully.');
  } catch (err) {
    console.error('[UserController] listUsers error:', err.message);
    return sendError(res, 'Failed to fetch users.', 500);
  }
};

// ── List Hosts (public-ish — used by visitor form) ────────────────────────────
/**
 * GET /api/users/hosts?department_id=X
 * Returns employees (hosts) of the given department.
 * Minimal data — no sensitive fields.
 */
const listHosts = async (req, res) => {
  try {
    const { department_id } = req.query;
    if (!department_id) return sendError(res, 'department_id query param is required.', 400);

    const [rows] = await db.query(
      `SELECT u.id, u.full_name, u.designation, u.role_type, d.name AS department_name
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.department_id = ?
         AND u.role_type IN ('employee', 'dept_admin')
         AND u.is_active = 1
         AND (u.deleted_at IS NULL OR u.deleted_at > NOW())
       ORDER BY u.full_name ASC`,
      [parseInt(department_id, 10)]
    );
    return sendSuccess(res, rows, 'Hosts fetched successfully.');
  } catch (err) {
    console.error('[UserController] listHosts error:', err.message);
    return sendError(res, 'Failed to fetch hosts.', 500);
  }
};

// ── Get User By ID ─────────────────────────────────────────────────────────────
const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.designation, u.employee_code,
              u.role_type, u.department_id, u.organization_id, u.is_active, u.created_at,
              d.name AS department_name, o.name AS organization_name
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN organizations o ON o.id = u.organization_id
       WHERE u.id = ? AND u.deleted_at IS NULL`,
      [id]
    );
    if (rows.length === 0) return sendError(res, 'User not found.', 404);

    // dept_admin can only view users in their own department
    if (isDeptAdmin(req.user) && rows[0].department_id !== req.user.department_id) {
      return sendError(res, 'Access forbidden.', 403);
    }

    return sendSuccess(res, rows[0], 'User fetched successfully.');
  } catch (err) {
    console.error('[UserController] getUserById error:', err.message);
    return sendError(res, 'Failed to fetch user.', 500);
  }
};

// ── Create User ───────────────────────────────────────────────────────────────
const createUser = async (req, res) => {
  try {
    const {
      full_name, email, phone, password,
      role_type, department_id, organization_id,
      employee_code, designation,
    } = req.body;

    if (!full_name || !email || !phone || !password || !role_type || !employee_code) {
      return sendError(res, 'full_name, email, phone, password, role_type, and employee_code are required.', 400);
    }

    // Role-based permission check
    if (isOrgAdmin(req.user)) {
      // org_admin can create any role
      if (!ALL_ROLES.includes(role_type)) {
        return sendError(res, `role_type must be one of: ${ALL_ROLES.join(', ')}.`, 400);
      }
    } else if (isDeptAdmin(req.user)) {
      // dept_admin can only create employee/security/receptionist in their own dept
      if (!MANAGEABLE_ROLES.includes(role_type)) {
        return sendError(res, 'Dept admins can only create employee, security, or receptionist users.', 403);
      }
    } else {
      return sendError(res, 'Access forbidden.', 403);
    }

    // Determine effective org + dept
    const effectiveOrgId  = isOrgAdmin(req.user) ? (organization_id || req.user.organization_id) : req.user.organization_id;
    // org_admin is allowed null dept; others must have one
    let effectiveDeptId;
    if (role_type === 'org_admin') {
      effectiveDeptId = null;
    } else if (isDeptAdmin(req.user)) {
      effectiveDeptId = req.user.department_id; // force their own dept
    } else {
      effectiveDeptId = department_id || null;
      if (!effectiveDeptId) return sendError(res, 'department_id is required for this role.', 400);
    }

    const [existing] = await db.query(
      `SELECT id FROM users WHERE email = ? OR phone = ? OR (employee_code = ? AND organization_id = ?) LIMIT 1`,
      [email, phone, employee_code, effectiveOrgId]
    );
    if (existing.length > 0) {
      return sendError(res, 'A user with this email, phone, or employee code already exists in this organization.', 409);
    }

    const password_hash = await bcrypt.hash(password, 12);

    const [result] = await db.query(
      `INSERT INTO users (full_name, email, phone, password_hash, role_type, department_id, organization_id, employee_code, designation, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, NOW(), NOW())`,
      [full_name, email, phone, password_hash, role_type, effectiveDeptId, effectiveOrgId, employee_code, designation || null]
    );

    const [newUser] = await db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.designation, u.employee_code,
              u.role_type, u.department_id, u.organization_id, u.is_active, u.created_at,
              d.name AS department_name
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.id = ?`,
      [result.insertId]
    );

    await logAudit({ userId: req.user.id, action: 'CREATE_USER', module: 'ADMIN', recordType: 'USER', recordId: result.insertId });
    return sendSuccess(res, newUser[0], 'User created successfully.', 201);
  } catch (err) {
    console.error('[UserController] createUser error:', err.message);
    return sendError(res, `Failed to create user: ${err.message}`, 500);
  }
};

// ── Update User ───────────────────────────────────────────────────────────────
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, email, phone, designation, role_type, department_id } = req.body;

    const [existing] = await db.query(`SELECT * FROM users WHERE id = ? AND deleted_at IS NULL`, [id]);
    if (existing.length === 0) return sendError(res, 'User not found.', 404);

    const targetUser = existing[0];

    // Dept admin can only edit users in their own dept
    if (isDeptAdmin(req.user) && targetUser.department_id !== req.user.department_id) {
      return sendError(res, 'Access forbidden.', 403);
    }

    // Dept admin cannot set role to org_admin or dept_admin
    if (isDeptAdmin(req.user) && role_type && !MANAGEABLE_ROLES.includes(role_type)) {
      return sendError(res, 'Dept admins cannot assign org_admin or dept_admin roles.', 403);
    }

    if (role_type) {
      if (!ALL_ROLES.includes(role_type)) {
        return sendError(res, `role_type must be one of: ${ALL_ROLES.join(', ')}.`, 400);
      }
    }

    // dept_admin cannot change department_id — lock to their dept
    const effectiveDeptId = isDeptAdmin(req.user)
      ? req.user.department_id
      : (department_id || null);

    await db.query(
      `UPDATE users
       SET full_name     = COALESCE(?, full_name),
           email         = COALESCE(?, email),
           phone         = COALESCE(?, phone),
           designation   = COALESCE(?, designation),
           role_type     = COALESCE(?, role_type),
           department_id = COALESCE(?, department_id),
           updated_at    = NOW()
       WHERE id = ?`,
      [full_name || null, email || null, phone || null, designation || null,
       role_type || null, effectiveDeptId, id]
    );

    const [updated] = await db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.designation, u.employee_code,
              u.role_type, u.department_id, u.organization_id, u.is_active, u.created_at,
              d.name AS department_name
       FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?`,
      [id]
    );

    await logAudit({ userId: req.user.id, action: 'UPDATE_USER', module: 'ADMIN', recordType: 'USER', recordId: parseInt(id) });
    return sendSuccess(res, updated[0], 'User updated successfully.');
  } catch (err) {
    console.error('[UserController] updateUser error:', err.message);
    if (err.code === 'ER_DUP_ENTRY') {
      return sendError(res, 'A user with this email or phone number already exists.', 409);
    }
    return sendError(res, 'Failed to update user.', 500);
  }
};

// ── Deactivate User ────────────────────────────────────────────────────────────
const deactivateUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (parseInt(id) === req.user.id) {
      return sendError(res, 'You cannot deactivate your own account.', 400);
    }

    const [existing] = await db.query(`SELECT id, is_active, department_id FROM users WHERE id = ? AND deleted_at IS NULL`, [id]);
    if (existing.length === 0) return sendError(res, 'User not found.', 404);

    // Dept admin can only deactivate users in their own dept
    if (isDeptAdmin(req.user) && existing[0].department_id !== req.user.department_id) {
      return sendError(res, 'Access forbidden.', 403);
    }

    if (!existing[0].is_active) return sendError(res, 'User is already deactivated.', 400);

    await db.query(
      `UPDATE users SET is_active = FALSE, deleted_at = NOW(), deleted_by = ?, updated_at = NOW() WHERE id = ?`,
      [req.user.id, id]
    );

    await logAudit({ userId: req.user.id, action: 'DEACTIVATE_USER', module: 'ADMIN', recordType: 'USER', recordId: parseInt(id) });
    return sendSuccess(res, { id: parseInt(id), is_active: false }, 'User deactivated successfully.');
  } catch (err) {
    console.error('[UserController] deactivateUser error:', err.message);
    return sendError(res, 'Failed to deactivate user.', 500);
  }
};

module.exports = { listUsers, listHosts, getUserById, createUser, updateUser, deactivateUser };
