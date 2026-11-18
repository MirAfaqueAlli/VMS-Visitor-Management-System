// backend/controllers/centralUser.controller.js
'use strict';

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { validatePassword } = require('../utils/passwordValidator.util');
const { centralPool, getPool, queryAllUnits } = require('../services/dbManager');
const { sendSuccess, sendError } = require('../utils/response.util');
const { logAudit } = require('../utils/auditLogger.util');
const { rejectIfContactTaken, phoneKey } = require('../services/contactUniqueness.service');

// Only super_admin can reach these endpoints (enforced in routes)

// ── List Central Users ────────────────────────────────────────────────────────
const listCentralUsers = async (req, res) => {
  try {
    const { search } = req.query;
    const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;

    const conditions = ['deleted_at IS NULL'];
    const params     = [];

    if (search && search.trim()) {
      conditions.push('(full_name LIKE ? OR email LIKE ? OR employee_code LIKE ?)');
      const like = `%${search.trim()}%`;
      params.push(like, like, like);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const [[{ total }]] = await centralPool.query(
      `SELECT COUNT(*) AS total FROM users ${where}`,
      params
    );

    const [rows] = await centralPool.query(
      `SELECT id, role_type, full_name, email, phone, employee_code, is_active,
              last_login_at, created_at, updated_at
       FROM users
       ${where}
       ORDER BY role_type ASC, full_name ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return sendSuccess(res, {
      users: rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    }, 'Central users fetched successfully.');
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

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return sendError(res, 'Please enter a valid email address (e.g. user@company.com).', 400);
    }

    // Validate phone format if provided
    if (phone && phone.trim()) {
      const digits = phone.replace(/\D/g, '');
      if (!/^[+]?[\d\s\-]+$/.test(phone.trim()) || digits.length < 7 || digits.length > 15) {
        return sendError(res, 'Phone number must contain only digits (7–15 digits). Example: +91 9000000000', 400);
      }
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

    // Email and mobile are unique across the whole system (central + every unit)
    if (await rejectIfContactTaken(res, sendError, { email, phone })) return;

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
    return sendError(res, 'Failed to create user. Please try again.', 500);
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
      'SELECT id, email, phone FROM users WHERE id = ? AND deleted_at IS NULL', [id]
    );
    if (existing.length === 0) return sendError(res, 'User not found.', 404);

    // Validate email format if provided
    if (email && email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return sendError(res, 'Please enter a valid email address (e.g. user@company.com).', 400);
      }
    }

    // Validate phone format if provided
    if (phone && phone.trim()) {
      const digits = phone.replace(/\D/g, '');
      if (!/^[+]?[\d\s\-]+$/.test(phone.trim()) || digits.length < 7 || digits.length > 15) {
        return sendError(res, 'Phone number must contain only digits (7–15 digits). Example: +91 9000000000', 400);
      }
    }

    // A changed email / mobile must not belong to any other account in the system.
    // Only changed values are checked, so older duplicates don't block unrelated edits.
    const current  = existing[0];
    const newEmail = email && email.trim() && email.trim().toLowerCase() !== String(current.email || '').toLowerCase() ? email : null;
    const newPhone = phone && phone.trim() && phoneKey(phone) !== phoneKey(current.phone) ? phone : null;
    if (newEmail || newPhone) {
      const taken = await rejectIfContactTaken(res, sendError, {
        email: newEmail, phone: newPhone, exclude: { pool: centralPool, id: Number(id) },
      });
      if (taken) return;
    }

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

// ── My unit membership (super admin joins a unit as an employee/host) ─────────
async function findSuperAdminProfile(centralUserId) {
  const results = await queryAllUnits(
    `SELECT id, unit_id, department_id, role_type, employee_code
     FROM users
     WHERE admin_central_user_id = ? AND is_admin_profile = 1
       AND deleted_at IS NULL AND is_active = 1
     LIMIT 1`,
    [centralUserId]
  );
  const hit = results.find(r => r.rows.length > 0);
  if (!hit) return null;
  return { ...hit.rows[0], unit_db: hit.unit_db, unit_name: hit.unit_name };
}

const getMyUnitProfile = async (req, res) => {
  try {
    if (req.user.role_type !== 'super_admin') return sendError(res, 'Access forbidden.', 403);
    const profile = await findSuperAdminProfile(req.user.id);
    if (!profile) return sendSuccess(res, null, 'No unit membership.');

    let departmentName = null;
    try {
      if (profile.department_id) {
        const [[dept]] = await getPool(profile.unit_db).query(
          'SELECT name FROM departments WHERE id = ? LIMIT 1', [profile.department_id]
        );
        departmentName = dept?.name || null;
      }
    } catch (_) { /* unit DB may be unavailable */ }

    const [[unit]] = await centralPool.query('SELECT id, name FROM units WHERE db_name = ? LIMIT 1', [profile.unit_db]);
    return sendSuccess(res, {
      unit_id: unit?.id ?? profile.unit_id,
      unit_name: unit?.name ?? profile.unit_name,
      unit_db: profile.unit_db,
      department_id: profile.department_id,
      department_name: departmentName,
      role_type: profile.role_type,
      employee_code: profile.employee_code,
    }, 'Unit membership fetched.');
  } catch (err) {
    console.error('[CentralUserController] getMyUnitProfile error:', err.message);
    return sendError(res, 'Failed to fetch unit membership.', 500);
  }
};

const updateMyUnitProfile = async (req, res) => {
  try {
    if (req.user.role_type !== 'super_admin') return sendError(res, 'Access forbidden.', 403);

    const unitId = parseInt(req.body.unit_id, 10);
    const departmentId = parseInt(req.body.department_id, 10);
    if (!unitId) return sendError(res, 'Select a unit.', 400);
    if (!departmentId) return sendError(res, 'Select a department. If this unit has none, ask a unit admin to create one first.', 400);

    const [[unit]] = await centralPool.query(
      `SELECT id, name, code, db_name FROM units WHERE id = ? AND is_active = 1 AND db_status = 'ACTIVE' LIMIT 1`,
      [unitId]
    );
    if (!unit) return sendError(res, 'Unit not found or inactive.', 404);

    const pool = getPool(unit.db_name);
    const [[dept]] = await pool.query(
      'SELECT id, name FROM departments WHERE id = ? AND is_active = 1 LIMIT 1', [departmentId]
    );
    if (!dept) {
      return sendError(res, 'Choose an active department. If this unit has none, ask a unit admin to create one first.', 400);
    }

    const existing = await findSuperAdminProfile(req.user.id);
    if (existing && existing.unit_db !== unit.db_name) {
      return sendError(res, `You already joined ${existing.unit_name}. Remove that membership before joining another unit.`, 409);
    }

    // Re-use a previously removed profile in this unit if one exists.
    const [existingRows] = await pool.query(
      `SELECT id FROM users WHERE admin_central_user_id = ? AND is_admin_profile = 1 LIMIT 1`,
      [req.user.id]
    );
    const profileId = existingRows[0]?.id || null;

    // No other user in this unit may already own the super admin's email/mobile.
    const phoneDigits = phoneKey(req.user.phone);
    const [conflict] = await pool.query(
      `SELECT id FROM users
       WHERE deleted_at IS NULL
         AND (? IS NULL OR id <> ?)
         AND (LOWER(email) = LOWER(?) OR (? <> '' AND RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', ''), 10) = ?))
       LIMIT 1`,
      [profileId, profileId, req.user.email, phoneDigits, phoneDigits]
    );
    if (conflict.length > 0) {
      return sendError(res, 'Another user in this unit already uses your email or mobile. Ask the unit admin to free it first.', 409);
    }

    let savedId = profileId;
    if (profileId) {
      await pool.query(
        `UPDATE users SET
           unit_id = ?, department_id = ?, role_type = 'employee',
           full_name = ?, email = ?, phone = ?,
           is_active = TRUE, deleted_at = NULL, updated_at = NOW()
         WHERE id = ?`,
        [unit.id, departmentId, req.user.full_name, req.user.email, req.user.phone || null, profileId]
      );
    } else {
      const prefix = `${unit.code}-EMP-`;
      const likePrefix = `${prefix.replace(/[\\%_]/g, '\\$&')}%`;
      const [codeRows] = await pool.query(
        'SELECT employee_code FROM users WHERE employee_code LIKE ?', [likePrefix]
      );
      const used = codeRows
        .map(r => r.employee_code.slice(prefix.length))
        .filter(rest => /^\d+$/.test(rest))
        .map(Number);
      const next = (used.length ? Math.max(...used) : 0) + 1;
      const employeeCode = `${prefix}${String(next).padStart(3, '0')}`;

      const randomPassword = crypto.randomBytes(24).toString('hex');
      const hash = await bcrypt.hash(randomPassword, 12);

      const [result] = await pool.query(
        `INSERT INTO users
           (unit_id, department_id, designation_id, role_type, is_admin_profile, admin_central_user_id,
            full_name, email, phone, password_hash, employee_code, is_active, created_at, updated_at)
         VALUES (?, ?, NULL, 'employee', 1, ?, ?, ?, ?, ?, ?, TRUE, NOW(), NOW())`,
        [unit.id, departmentId, req.user.id, req.user.full_name, req.user.email, req.user.phone || null, hash, employeeCode]
      );
      savedId = result.insertId;
    }

    await logAudit({
      isSuperAdminAction: true,
      userId: req.user.id,
      action: 'JOIN_UNIT_AS_HOST',
      module: 'ADMIN',
      recordType: 'USER',
      recordId: savedId,
      newValues: { unit_id: unit.id, department_id: departmentId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    const profile = await findSuperAdminProfile(req.user.id);
    return sendSuccess(res, { ...profile, unit_name: unit.name, department_name: dept.name }, 'Unit membership saved.');
  } catch (err) {
    console.error('[CentralUserController] updateMyUnitProfile error:', err.message);
    if (err.code === 'ER_DUP_ENTRY') {
      return sendError(res, 'This email, phone or employee code is already used in that unit.', 409);
    }
    return sendError(res, 'Failed to save unit membership.', 500);
  }
};

const removeMyUnitProfile = async (req, res) => {
  try {
    if (req.user.role_type !== 'super_admin') return sendError(res, 'Access forbidden.', 403);
    const profile = await findSuperAdminProfile(req.user.id);
    if (!profile) return sendSuccess(res, null, 'No unit membership to remove.');

    await getPool(profile.unit_db).query(
      `UPDATE users SET is_active = FALSE, deleted_at = NOW(), updated_at = NOW() WHERE id = ?`,
      [profile.id]
    );

    await logAudit({
      isSuperAdminAction: true,
      userId: req.user.id,
      action: 'LEAVE_UNIT_AS_HOST',
      module: 'ADMIN',
      recordType: 'USER',
      recordId: profile.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    return sendSuccess(res, null, 'Unit membership removed.');
  } catch (err) {
    console.error('[CentralUserController] removeMyUnitProfile error:', err.message);
    return sendError(res, 'Failed to remove unit membership.', 500);
  }
};

module.exports = {
  listCentralUsers, createCentralUser, updateCentralUser, deactivateCentralUser,
  getMyUnitProfile, updateMyUnitProfile, removeMyUnitProfile,
};
