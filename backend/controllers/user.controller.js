// backend/controllers/user.controller.js
'use strict';

const bcrypt = require('bcrypt');
const { validatePassword } = require('../utils/passwordValidator.util');
const { centralPool, getPool } = require('../services/dbManager');
const { sendSuccess, sendError } = require('../utils/response.util');
const { logAudit }               = require('../utils/auditLogger.util');
const { isSuperAdmin, isUnitAdmin } = require('../middlewares/rbac.middleware');

// ── Role sets ─────────────────────────────────────────────────────────────────
const UNIT_MANAGEABLE_ROLES = ['unit_admin', 'employee', 'security', 'receptionist', 'unit_auditor'];

// ── List Users ────────────────────────────────────────────────────────────────
/**
 * GET /api/users?page=1&limit=10&role=employee&search=john
 * super_admin / unit_admin → all users in their unit DB
 */
const listUsers = async (req, res) => {
  try {
    const { role, search } = req.query;
    const page   = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit  = Math.max(1, parseInt(req.query.limit || '10', 10));
    const offset = (page - 1) * limit;

    const conditions = ['u.deleted_at IS NULL'];
    const params     = [];

    if (!isSuperAdmin(req.user) && !isUnitAdmin(req.user)) {
      return sendError(res, 'Access forbidden.', 403);
    }

    if (role) {
      conditions.push('u.role_type = ?');
      params.push(role);
    }

    if (search && search.trim()) {
      conditions.push('(u.full_name LIKE ? OR u.email LIKE ? OR u.employee_code LIKE ?)');
      const like = `%${search.trim()}%`;
      params.push(like, like, like);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const [[{ total }]] = await req.db.query(
      `SELECT COUNT(*) AS total FROM users u ${where}`,
      params
    );

    const [rows] = await req.db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.designation, u.designation_id,
              u.employee_code, u.role_type, u.department_id, u.unit_id,
              u.is_active, u.created_at, u.last_login_at,
              d.name AS department_name
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       ${where}
       ORDER BY u.full_name ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return sendSuccess(res, {
      users: rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    }, 'Users fetched successfully.');
  } catch (err) {
    console.error('[UserController] listUsers error:', err.message);
    return sendError(res, 'Failed to fetch users.', 500);
  }
};


// ── List Hosts (public-ish — used by visitor form and employee visit picker) ─────────
/**
 * GET /api/users/hosts?department_id=X&unit_id=5
 * Returns employees (hosts) of the given department.
 * Supports unit_id (numeric) or legacy unit_code for cross-unit lookups.
 */
const listHosts = async (req, res) => {
  try {
    const { department_id, unit_code, unit_id, include_all } = req.query;

    let dbPool = null;
    const isCrossUnit = !!(unit_id || unit_code); // visiting a specific unit by ID or code

    // Resolve DB from unit_id (preferred) or unit_code (legacy), else use req.db
    if (unit_id) {
      const [unitRows] = await centralPool.query(
        `SELECT db_name FROM units WHERE id = ? AND is_active = 1 AND db_status = 'ACTIVE'`,
        [parseInt(unit_id, 10)]
      );
      if (unitRows.length === 0) return sendError(res, 'Unit not found.', 404);
      dbPool = getPool(unitRows[0].db_name);
    } else if (unit_code) {
      const [unitRows] = await centralPool.query(
        `SELECT db_name FROM units WHERE code = ? AND is_active = 1 AND db_status = 'ACTIVE'`,
        [unit_code.toUpperCase().trim()]
      );
      if (unitRows.length === 0) return sendError(res, 'Unit not found.', 404);
      dbPool = getPool(unitRows[0].db_name);
    } else if (req.db) {
      dbPool = req.db;
    } else {
      return sendError(res, 'unit_id or unit_code is required for host lookup.', 400);
    }

    // Build role filter:
    // - If caller explicitly passes `roles` param (e.g. "employee" or "employee,unit_admin"),
    //   honour that exactly — used by Employee Visit picker to show only employees.
    // - Otherwise fall back to legacy logic:
    //   cross-unit → all staff roles; same-unit dept-filter → employee only.
    let roleFilter;
    if (req.query.roles) {
      const SAFE_ROLES = ['employee', 'unit_admin', 'receptionist', 'security', 'unit_auditor'];
      const allowedRoles = req.query.roles
        .split(',')
        .map(r => r.trim())
        .filter(r => SAFE_ROLES.includes(r))
        .map(r => `'${r}'`)
        .join(', ');
      roleFilter = allowedRoles.length > 0
        ? `u.role_type IN (${allowedRoles})`
        : `u.role_type = 'employee'`; // fallback safety
    } else {
      roleFilter = isCrossUnit
        ? `u.role_type IN ('employee', 'unit_admin', 'receptionist', 'security')`
        : `u.role_type = 'employee'`;
    }

    let rows;
    if (include_all === 'true' || !department_id) {
      // No department filter — return all eligible users in the unit
      [rows] = await dbPool.query(
        `SELECT u.id, u.full_name, u.email, u.phone, u.designation, u.designation_id,
                u.role_type, u.department_id, u.unit_id,
                des.name AS designation_name,
                d.name AS department_name
         FROM users u
         LEFT JOIN departments d    ON d.id   = u.department_id
         LEFT JOIN designations des ON des.id = u.designation_id
         WHERE ${roleFilter}
           AND u.is_active = 1
           AND u.deleted_at IS NULL
         ORDER BY u.full_name ASC`
      );
    } else {
      // Department-scoped lookup
      [rows] = await dbPool.query(
        `SELECT u.id, u.full_name, u.email, u.phone, u.designation, u.designation_id,
                u.role_type, u.department_id, u.unit_id,
                des.name AS designation_name,
                d.name AS department_name
         FROM users u
         LEFT JOIN departments d    ON d.id   = u.department_id
         LEFT JOIN designations des ON des.id = u.designation_id
         WHERE u.department_id = ?
           AND ${roleFilter}
           AND u.is_active = 1
           AND u.deleted_at IS NULL
         ORDER BY u.full_name ASC`,
        [parseInt(department_id, 10)]
      );
    }

    // Debug log for cross-unit employee lookup troubleshooting
    

    return sendSuccess(res, rows, 'Hosts fetched successfully.');
  } catch (err) {
    console.error('[UserController] listHosts error:', err.message);
    return sendError(res, 'Failed to fetch hosts.', 500);
  }
};


// ── Get User By ID ────────────────────────────────────────────────────────────
const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await req.db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.designation, u.designation_id,
              u.employee_code, u.role_type, u.department_id, u.unit_id,
              u.is_active, u.created_at, u.last_login_at,
              d.name AS department_name
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.id = ? AND u.deleted_at IS NULL`,
      [id]
    );

    if (rows.length === 0) return sendError(res, 'User not found.', 404);



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
      role_type, department_id,
      employee_code, designation, designation_id,
      unit_id,
    } = req.body;

    if (!full_name || !email || !password || !role_type || !employee_code) {
      return sendError(res, 'full_name, email, password, role_type, and employee_code are required.', 400);
    }

    // Role-based permission check
    if (isSuperAdmin(req.user) || isUnitAdmin(req.user)) {
      if (!UNIT_MANAGEABLE_ROLES.includes(role_type)) {
        return sendError(res, `role_type must be one of: ${UNIT_MANAGEABLE_ROLES.join(', ')}.`, 400);
      }
    } else {
      return sendError(res, 'Access forbidden.', 403);
    }

    // Determine effective unit_id and dept_id
    // For unit_admin: use their own unit_id.
    // For super_admin managing a unit: prefer body unit_id, then the X-Unit-Id header
    // that the frontend sends automatically when activeUnit is set.
    const headerUnitId = req.headers['x-unit-id'] ? parseInt(req.headers['x-unit-id'], 10) : null;
    const effectiveUnitId = isUnitAdmin(req.user)
      ? req.user.unit_id
      : (unit_id || headerUnitId || null);

    const effectiveDeptId = department_id || null;
    // dept is required for non-admin roles
    if (!effectiveDeptId && !['unit_admin', 'unit_auditor', 'security', 'receptionist'].includes(role_type)) {
      return sendError(res, 'department_id is required for this role.', 400);
    }

    // Check for duplicates within this unit DB
    const [existing] = await req.db.query(
      `SELECT id FROM users WHERE (email = ? OR phone = ? OR employee_code = ?) AND deleted_at IS NULL LIMIT 1`,
      [email, phone || '', employee_code]
    );
    if (existing.length > 0) {
      return sendError(res, 'A user with this email, phone, or employee code already exists in this unit.', 409);
    }

    // Enforce password policy
    const { valid, errors } = validatePassword(password);
    if (!valid) return sendError(res, errors[0], 400);

    const password_hash = await bcrypt.hash(password, 12);

    const [result] = await req.db.query(
      `INSERT INTO users
         (unit_id, department_id, designation_id, role_type, full_name, email, phone,
          password_hash, employee_code, designation, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, NOW(), NOW())`,
      [effectiveUnitId, effectiveDeptId || null, designation_id || null,
       role_type, full_name, email, phone || null,
       password_hash, employee_code, designation || null]
    );

    const [newUser] = await req.db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.designation, u.designation_id,
              u.employee_code, u.role_type, u.department_id, u.unit_id,
              u.is_active, u.created_at, d.name AS department_name
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.id = ?`,
      [result.insertId]
    );

    await logAudit({
      db:        req.db,
      userId:    req.user.id,
      action:    'CREATE_USER',
      module:    'ADMIN',
      recordType: 'USER',
      recordId:  result.insertId,
      newValues: { role_type, email },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    return sendSuccess(res, newUser[0], 'User created successfully.', 201);
  } catch (err) {
    console.error('[UserController] createUser error:', err.message);
    if (err.code === 'ER_DUP_ENTRY') {
      return sendError(res, 'A user with this email, phone, or employee code already exists.', 409);
    }
    return sendError(res, `Failed to create user: ${err.message}`, 500);
  }
};

// ── Update User ───────────────────────────────────────────────────────────────
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, email, phone, designation, designation_id, role_type, department_id } = req.body;

    const [existing] = await req.db.query(
      `SELECT * FROM users WHERE id = ? AND deleted_at IS NULL`, [id]
    );
    if (existing.length === 0) return sendError(res, 'User not found.', 404);

    const targetUser = existing[0];

    if (role_type && !UNIT_MANAGEABLE_ROLES.includes(role_type)) {
      return sendError(res, `role_type must be one of: ${UNIT_MANAGEABLE_ROLES.join(', ')}.`, 400);
    }

    const effectiveDeptId = department_id !== undefined ? department_id : targetUser.department_id;

    await req.db.query(
      `UPDATE users SET
         full_name      = COALESCE(?, full_name),
         email          = COALESCE(?, email),
         phone          = COALESCE(?, phone),
         designation    = COALESCE(?, designation),
         designation_id = COALESCE(?, designation_id),
         role_type      = COALESCE(?, role_type),
         department_id  = ?,
         updated_at     = NOW()
       WHERE id = ?`,
      [full_name || null, email || null, phone || null,
       designation || null, designation_id || null,
       role_type || null, effectiveDeptId, id]
    );

    const [updated] = await req.db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.designation, u.designation_id,
              u.employee_code, u.role_type, u.department_id, u.unit_id,
              u.is_active, u.created_at, d.name AS department_name
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?`,
      [id]
    );

    await logAudit({
      db:        req.db,
      userId:    req.user.id,
      action:    'UPDATE_USER',
      module:    'ADMIN',
      recordType: 'USER',
      recordId:  parseInt(id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

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

    const [existing] = await req.db.query(
      `SELECT id, is_active, department_id FROM users WHERE id = ? AND deleted_at IS NULL`, [id]
    );
    if (existing.length === 0) return sendError(res, 'User not found.', 404);



    if (!existing[0].is_active) return sendError(res, 'User is already deactivated.', 400);

    await req.db.query(
      `UPDATE users SET is_active = FALSE, deleted_at = NOW(), deleted_by = ?, updated_at = NOW() WHERE id = ?`,
      [req.user.id, id]
    );

    await logAudit({
      db:        req.db,
      userId:    req.user.id,
      action:    'DEACTIVATE_USER',
      module:    'ADMIN',
      recordType: 'USER',
      recordId:  parseInt(id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    return sendSuccess(res, { id: parseInt(id), is_active: false }, 'User deactivated successfully.');
  } catch (err) {
    console.error('[UserController] deactivateUser error:', err.message);
    return sendError(res, 'Failed to deactivate user.', 500);
  }
};

module.exports = { listUsers, listHosts, getUserById, createUser, updateUser, deactivateUser };
