// backend/controllers/unit.controller.js
'use strict';

const { centralPool, getPool, provisionUnitDb } = require('../services/dbManager');
const { sendSuccess, sendError }                = require('../utils/response.util');
const { logAudit }                              = require('../utils/auditLogger.util');
const { isSuperAdmin, isGlobalAuditor }         = require('../middlewares/rbac.middleware');
const bcrypt = require('bcrypt');
const { validatePassword } = require('../utils/passwordValidator.util');

// ── List Units ────────────────────────────────────────────────────────────────
/**
 * GET /api/units?page=1&limit=10&search=hq
 * super_admin → all units
 * global_auditor → all units (read-only)
 */
const listUnits = async (req, res) => {
  try {
    const { search } = req.query;
    const page   = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit  = Math.max(1, parseInt(req.query.limit || '10', 10));
    const offset = (page - 1) * limit;

    const conditions = [];
    const params     = [];

    if (search && search.trim()) {
      conditions.push('(u.name LIKE ? OR u.code LIKE ? OR u.city LIKE ?)');
      const like = `%${search.trim()}%`;
      params.push(like, like, like);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [[{ total }]] = await centralPool.query(
      `SELECT COUNT(*) AS total FROM units u ${where}`,
      params
    );

    const [units] = await centralPool.query(
      `SELECT u.id, u.name, u.code, u.type, u.db_name, u.db_status,
              u.city, u.state, u.phone, u.email, u.is_active,
              u.created_at, u.updated_at,
              o.name AS organization_name
       FROM units u
       JOIN organizations o ON o.id = u.organization_id
       ${where}
       ORDER BY u.name ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // For each unit in this PAGE only, fetch live stats from its own DB
    const enriched = await Promise.all(
      units.map(async (unit) => {
        let userCount = 0;
        let deptCount = 0;
        if (unit.db_status === 'ACTIVE') {
          try {
            const pool = getPool(unit.db_name);
            const [[uCount]] = await pool.query(
              'SELECT COUNT(*) AS cnt FROM users WHERE is_active = 1 AND deleted_at IS NULL'
            );
            const [[dCount]] = await pool.query(
              'SELECT COUNT(*) AS cnt FROM departments WHERE is_active = 1'
            );
            userCount = uCount.cnt;
            deptCount = dCount.cnt;
          } catch (_) { /* unit DB might not be accessible — skip silently */ }
        }
        return { ...unit, user_count: userCount, department_count: deptCount };
      })
    );

    return sendSuccess(res, {
      units: enriched,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    }, 'Units fetched successfully.');
  } catch (err) {
    console.error('[UnitController] listUnits error:', err.message);
    return sendError(res, 'Failed to fetch units.', 500);
  }
};


// ── Get Unit By ID ────────────────────────────────────────────────────────────
const getUnitById = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await centralPool.query(
      `SELECT u.*, o.name AS organization_name
       FROM units u JOIN organizations o ON o.id = u.organization_id
       WHERE u.id = ?`,
      [id]
    );
    if (rows.length === 0) return sendError(res, 'Unit not found.', 404);

    const unit = rows[0];
    let stats = { user_count: 0, department_count: 0 };

    if (unit.db_status === 'ACTIVE') {
      try {
        const pool = getPool(unit.db_name);
        const [[uCount]] = await pool.query('SELECT COUNT(*) AS cnt FROM users WHERE is_active = 1 AND deleted_at IS NULL');
        const [[dCount]] = await pool.query('SELECT COUNT(*) AS cnt FROM departments WHERE is_active = 1');
        stats = { user_count: uCount.cnt, department_count: dCount.cnt };
      } catch (_) {}
    }

    return sendSuccess(res, { ...unit, ...stats }, 'Unit fetched successfully.');
  } catch (err) {
    console.error('[UnitController] getUnitById error:', err.message);
    return sendError(res, 'Failed to fetch unit.', 500);
  }
};

// ── Create Unit ───────────────────────────────────────────────────────────────
/**
 * POST /api/units
 * Body: { name, code, type?, city?, state?, phone?, email?, address?,
 *         unit_admin: { full_name, email, phone, password, employee_code } }
 *
 * 1. Validates code uniqueness in central DB
 * 2. Inserts unit record (db_status = PROVISIONING)
 * 3. Provisions the unit database (runs vms_unit_schema.sql)
 * 4. Updates db_status = ACTIVE
 * 5. Optionally creates the first unit_admin user in the new unit DB
 */
const createUnit = async (req, res) => {
  try {
    const { name, code, city, state, phone, email, address, unit_admin } = req.body;
    const type = req.body.type || 'UNIT'; // Default to 'UNIT' if not provided

    if (!name || !code) return sendError(res, 'name and code are required.', 400);

    if (unit_admin) {
      const { full_name: adminName, email: adminEmail, password: adminPass, employee_code: adminCode } = unit_admin;
      if (!adminName || !adminName.trim() || !adminEmail || !adminEmail.trim() || !adminPass || !adminPass.trim() || !adminCode || !adminCode.trim()) {
        return sendError(res, 'Unit admin name, email, password, and employee code are required when creating an admin.', 400);
      }
    }

    const sanitizedCode = code.toUpperCase().trim();

    // Check uniqueness
    const [existing] = await centralPool.query(
      'SELECT id FROM units WHERE code = ?', [sanitizedCode]
    );
    if (existing.length > 0) return sendError(res, 'A unit with this code already exists.', 409);

    // Build the db_name: vms_unit_{code_lowercase}
    const dbName = `vms_unit_${sanitizedCode.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

    // Get the root organization id
    const [[org]] = await centralPool.query('SELECT id FROM organizations LIMIT 1');
    if (!org) return sendError(res, 'No root organization found. Set up the central database first.', 500);

    // Insert unit record (PROVISIONING state)
    const [result] = await centralPool.query(
      `INSERT INTO units (organization_id, name, code, type, db_name, db_status,
                          address, city, state, phone, email, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'PROVISIONING', ?, ?, ?, ?, ?, TRUE, NOW(), NOW())`,
      [org.id, name, sanitizedCode, type || null, dbName,
       address || null, city || null, state || null, phone || null, email || null]
    );
    const unitId = result.insertId;

    // Provision the database
    try {
      await provisionUnitDb(dbName);
    } catch (provErr) {
      // Rollback: deactivate the unit record
      await centralPool.query(`UPDATE units SET db_status = 'SUSPENDED', is_active = FALSE WHERE id = ?`, [unitId]);
      console.error('[UnitController] DB provisioning failed:', provErr.message);
      return sendError(res, `Unit created but database provisioning failed: ${provErr.message}`, 500);
    }

    // Mark ACTIVE
    await centralPool.query(`UPDATE units SET db_status = 'ACTIVE', updated_at = NOW() WHERE id = ?`, [unitId]);

    // Optionally create the first unit_admin in the new unit DB
    if (unit_admin) {
      const { full_name: adminName, email: adminEmail, phone: adminPhone,
              password: adminPass, employee_code: adminCode } = unit_admin;

      if (adminName && adminEmail && adminPass && adminCode) {
        // Enforce password policy
        const { valid, errors } = validatePassword(adminPass);
        if (!valid) return sendError(res, `Unit admin password: ${errors[0]}`, 400);

        const hash = await bcrypt.hash(adminPass, 12);
        const unitPool = getPool(dbName);
        await unitPool.query(
          `INSERT INTO users (unit_id, role_type, full_name, email, phone,
                              password_hash, employee_code, is_active, created_at, updated_at)
           VALUES (?, 'unit_admin', ?, ?, ?, ?, ?, TRUE, NOW(), NOW())`,
          [unitId, adminName, adminEmail, adminPhone || null, hash, adminCode]
        );
      }
    }

    // Audit log (super admin action → central global_audit_logs)
    await logAudit({
      isSuperAdminAction: true,
      sourceUnit:         dbName,
      userId:             req.user.id,
      action:             'CREATE_UNIT',
      module:             'ADMIN',
      recordType:         'UNIT',
      recordId:           unitId,
      newValues:          { name, code: sanitizedCode, db_name: dbName },
      ipAddress:          req.ip,
      userAgent:          req.headers['user-agent'] || null,
    });

    const [newUnit] = await centralPool.query('SELECT * FROM units WHERE id = ?', [unitId]);
    return sendSuccess(res, newUnit[0], 'Unit created and database provisioned successfully.', 201);
  } catch (err) {
    console.error('[UnitController] createUnit error:', err.message);
    if (err.code === 'ER_DUP_ENTRY') return sendError(res, 'A unit with this code already exists.', 409);
    return sendError(res, 'Failed to create unit.', 500);
  }
};

// ── Update Unit ───────────────────────────────────────────────────────────────
const updateUnit = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, address, city, state, phone, email } = req.body;

    const [existing] = await centralPool.query('SELECT id FROM units WHERE id = ?', [id]);
    if (existing.length === 0) return sendError(res, 'Unit not found.', 404);

    await centralPool.query(
      `UPDATE units SET
         name    = COALESCE(?, name),
         type    = COALESCE(?, type),
         address = COALESCE(?, address),
         city    = COALESCE(?, city),
         state   = COALESCE(?, state),
         phone   = COALESCE(?, phone),
         email   = COALESCE(?, email),
         updated_at = NOW()
       WHERE id = ?`,
      [name || null, type || null, address || null, city || null,
       state || null, phone || null, email || null, id]
    );

    await logAudit({
      isSuperAdminAction: true,
      userId:    req.user.id,
      action:    'UPDATE_UNIT',
      module:    'ADMIN',
      recordType: 'UNIT',
      recordId:  parseInt(id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    const [updated] = await centralPool.query('SELECT * FROM units WHERE id = ?', [id]);
    return sendSuccess(res, updated[0], 'Unit updated successfully.');
  } catch (err) {
    console.error('[UnitController] updateUnit error:', err.message);
    return sendError(res, 'Failed to update unit.', 500);
  }
};

// ── Deactivate Unit ───────────────────────────────────────────────────────────
const deactivateUnit = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await centralPool.query('SELECT * FROM units WHERE id = ?', [id]);
    if (rows.length === 0) return sendError(res, 'Unit not found.', 404);

    const unit = rows[0];

    // Check for active users in unit DB
    if (unit.db_status === 'ACTIVE') {
      try {
        const pool = getPool(unit.db_name);
        const [[{ cnt }]] = await pool.query(
          'SELECT COUNT(*) AS cnt FROM users WHERE is_active = 1 AND deleted_at IS NULL'
        );
        if (cnt > 0) {
          return sendError(res, `Cannot deactivate — ${cnt} active user(s) exist in this unit.`, 409);
        }
      } catch (_) {}
    }

    await centralPool.query(
      `UPDATE units SET is_active = FALSE, db_status = 'SUSPENDED', updated_at = NOW() WHERE id = ?`,
      [id]
    );

    await logAudit({
      isSuperAdminAction: true,
      userId:     req.user.id,
      action:     'DEACTIVATE_UNIT',
      module:     'ADMIN',
      recordType: 'UNIT',
      recordId:   parseInt(id),
      ipAddress:  req.ip,
      userAgent:  req.headers['user-agent'] || null,
    });

    return sendSuccess(res, { id: parseInt(id), is_active: false }, 'Unit deactivated successfully.');
  } catch (err) {
    console.error('[UnitController] deactivateUnit error:', err.message);
    return sendError(res, 'Failed to deactivate unit.', 500);
  }
};

// ── Public Units (no auth) ───────────────────────────────────────────────────
/**
 * GET /api/units/public
 * Returns a minimal list of all active units — no auth required.
 * Used by the Login page dropdown and PublicRequest form.
 */
const getPublicUnits = async (req, res) => {
  try {
    const [rows] = await centralPool.query(
      `SELECT id, name, code, city, state
       FROM units
       WHERE is_active = 1 AND db_status = 'ACTIVE'
       ORDER BY name ASC`
    );
    return sendSuccess(res, rows, 'Units fetched.');
  } catch (err) {
    console.error('[UnitController] getPublicUnits error:', err.message);
    return sendError(res, 'Failed to fetch units.', 500);
  }
};

// ── Public: Lookup unit by code (no auth) ────────────────────────────────────
/**
 * GET /api/units/by-code/:code
 * Returns { id, name, code, city, state } for a single active unit.
 * Used by the unit-scoped login URL (/login/:unitCode) to validate the code.
 */
const getUnitByCode = async (req, res) => {
  try {
    const code = (req.params.code || '').toUpperCase().trim();
    if (!code) return sendError(res, 'Unit code is required.', 400);

    const [rows] = await centralPool.query(
      `SELECT id, name, code, city, state
       FROM units
       WHERE code = ? AND is_active = 1 AND db_status = 'ACTIVE'
       LIMIT 1`,
      [code]
    );

    if (!rows.length) return sendError(res, `No active unit found with code "${code}".`, 404);
    return sendSuccess(res, rows[0], 'Unit found.');
  } catch (err) {
    console.error('[UnitController] getUnitByCode error:', err.message);
    return sendError(res, 'Failed to look up unit.', 500);
  }
};

module.exports = { listUnits, getUnitById, createUnit, updateUnit, deactivateUnit, getPublicUnits, getUnitByCode };

