// backend/controllers/centralUser.controller.js
'use strict';

const bcrypt = require('bcrypt');
const { validatePassword } = require('../utils/passwordValidator.util');
const { centralPool } = require('../services/dbManager');
const { sendSuccess, sendError } = require('../utils/response.util');
const { logAudit } = require('../utils/auditLogger.util');

// Only super_admin can reach these endpoints (enforced in routes)

// ── List Central Users ────────────────────────────────────────────────────────
const listCentralUsers = async (req, res) => {
  try {
    const [rows] = await centralPool.query(
      `SELECT id, role_type, full_name, email, phone, employee_code, is_active,
              last_login_at, created_at, updated_at
       FROM users
       WHERE deleted_at IS NULL
       ORDER BY role_type ASC, full_name ASC`
    );
    return sendSuccess(res, rows, 'Central users fetched successfully.');
  } catch (err) {
    console.error('[CentralUserController] listCentralUsers error:', err.message);
    return sendError(res, 'Failed to fetch central users.', 500);
  }
};

// ── Create Central User ───────────────────────────────────────────────────────
const createCentralUser = async (req, res) => {
  try {
    const { full_name, email, phone, employee_code, password, role_type } = req.body;

    if (!full_name || !email || !employee_code || !password || !role_type) {
      return sendError(res, 'full_name, email, employee_code, password, and role_type are required.', 400);
    }

    // Only global_auditor can be created this way — super_admin is provisioned via schema
    if (!['global_auditor', 'super_admin'].includes(role_type)) {
      return sendError(res, 'role_type must be global_auditor or super_admin.', 400);
    }

    // Prevent creating another super_admin to avoid privilege escalation accidentally
    if (role_type === 'super_admin') {
      return sendError(res, 'Additional super_admin accounts cannot be created through the UI. Contact the system DBA.', 403);
    }

    // Enforce password policy
    const { valid, errors } = validatePassword(password);
    if (!valid) return sendError(res, errors[0], 400);

    const hash = await bcrypt.hash(password, 12);

    const [result] = await centralPool.query(
      `INSERT INTO users (role_type, full_name, email, phone, employee_code, password_hash,
                          is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, TRUE, NOW(), NOW())`,
      [role_type, full_name.trim(), email.trim().toLowerCase(),
       phone?.trim() || null, employee_code.trim(), hash]
    );

    const [newUser] = await centralPool.query(
      `SELECT id, role_type, full_name, email, phone, employee_code, is_active, created_at
       FROM users WHERE id = ?`,
      [result.insertId]
    );

    await logAudit({
      isSuperAdminAction: true,
      userId:    req.user.id,
      action:    'CREATE_CENTRAL_USER',
      module:    'ADMIN',
      recordType: 'USER',
      recordId:  result.insertId,
      newValues: { role_type, email: email.trim().toLowerCase() },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    return sendSuccess(res, newUser[0], 'Central user created successfully.', 201);
  } catch (err) {
    console.error('[CentralUserController] createCentralUser error:', err.message);
    if (err.code === 'ER_DUP_ENTRY') {
      return sendError(res, 'A user with this email, phone, or employee code already exists.', 409);
    }
    return sendError(res, `Failed to create user: ${err.message}`, 500);
  }
};

// ── Update Central User ───────────────────────────────────────────────────────
const updateCentralUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, email, phone, employee_code } = req.body;

    // Prevent a super_admin from accidentally editing their own role
    if (parseInt(id) === req.user.id) {
      return sendError(res, 'You cannot edit your own account here. Use the Profile page.', 400);
    }

    const [existing] = await centralPool.query(
      'SELECT id FROM users WHERE id = ? AND deleted_at IS NULL', [id]
    );
    if (existing.length === 0) return sendError(res, 'User not found.', 404);

    await centralPool.query(
      `UPDATE users SET
         full_name     = COALESCE(?, full_name),
         email         = COALESCE(?, email),
         phone         = COALESCE(?, phone),
         employee_code = COALESCE(?, employee_code),
         updated_at    = NOW()
       WHERE id = ?`,
      [full_name?.trim() || null, email?.trim().toLowerCase() || null,
       phone?.trim() || null, employee_code?.trim() || null, id]
    );

    const [updated] = await centralPool.query(
      `SELECT id, role_type, full_name, email, phone, employee_code, is_active, created_at, updated_at
       FROM users WHERE id = ?`,
      [id]
    );

    await logAudit({
      isSuperAdminAction: true,
      userId:    req.user.id,
      action:    'UPDATE_CENTRAL_USER',
      module:    'ADMIN',
      recordType: 'USER',
      recordId:  parseInt(id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    return sendSuccess(res, updated[0], 'User updated successfully.');
  } catch (err) {
    console.error('[CentralUserController] updateCentralUser error:', err.message);
    if (err.code === 'ER_DUP_ENTRY') {
      return sendError(res, 'A user with this email or employee code already exists.', 409);
    }
    return sendError(res, 'Failed to update user.', 500);
  }
};

// ── Deactivate Central User ───────────────────────────────────────────────────
const deactivateCentralUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (parseInt(id) === req.user.id) {
      return sendError(res, 'You cannot deactivate your own account.', 400);
    }

    const [existing] = await centralPool.query(
      'SELECT id, is_active, role_type FROM users WHERE id = ? AND deleted_at IS NULL', [id]
    );
    if (existing.length === 0) return sendError(res, 'User not found.', 404);
    if (!existing[0].is_active) return sendError(res, 'User is already deactivated.', 400);

    await centralPool.query(
      `UPDATE users SET is_active = FALSE, deleted_at = NOW(), updated_at = NOW() WHERE id = ?`,
      [id]
    );

    await logAudit({
      isSuperAdminAction: true,
      userId:    req.user.id,
      action:    'DEACTIVATE_CENTRAL_USER',
      module:    'ADMIN',
      recordType: 'USER',
      recordId:  parseInt(id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    return sendSuccess(res, { id: parseInt(id), is_active: false }, 'User deactivated successfully.');
  } catch (err) {
    console.error('[CentralUserController] deactivateCentralUser error:', err.message);
    return sendError(res, 'Failed to deactivate user.', 500);
  }
};

module.exports = { listCentralUsers, createCentralUser, updateCentralUser, deactivateCentralUser };
