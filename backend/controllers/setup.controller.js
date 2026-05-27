// backend/controllers/setup.controller.js
'use strict';

const bcrypt = require('bcrypt');
const { centralPool } = require('../services/dbManager');
const { sendSuccess, sendError } = require('../utils/response.util');

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
 *   admin_phone?,
 *   admin_password,
 *   admin_employee_code?,
 * }
 * Guards: fails if org or super_admin already exists.
 */
const initialize = async (req, res) => {
  try {
    // Guard — already initialized?
    const [[{ orgCount }]] = await centralPool.query(
      'SELECT COUNT(*) AS orgCount FROM organizations'
    );
    const [[{ adminCount }]] = await centralPool.query(
      `SELECT COUNT(*) AS adminCount FROM users WHERE role_type = 'super_admin'`
    );
    if (orgCount > 0 || adminCount > 0) {
      return sendError(res, 'System is already initialized. Setup can only run once.', 409);
    }

    const {
      org_name, org_code,
      org_city  = null, org_state  = null,
      org_phone = null, org_email  = null,
      admin_name, admin_email,
      admin_phone         = null,
      admin_password,
      admin_employee_code = 'SA-001',
    } = req.body;

    // ── Validate ──────────────────────────────────────────────────────────────
    if (!org_name?.trim())        return sendError(res, 'org_name is required.',        400);
    if (!org_code?.trim())        return sendError(res, 'org_code is required.',         400);
    if (!admin_name?.trim())      return sendError(res, 'admin_name is required.',       400);
    if (!admin_email?.trim())     return sendError(res, 'admin_email is required.',      400);
    if (!admin_password?.trim())  return sendError(res, 'admin_password is required.',   400);
    if (admin_password.length < 8)
      return sendError(res, 'Password must be at least 8 characters.', 400);

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

    console.log(`[Setup] System initialized — org "${org_name}" (id=${orgId}), super_admin "${admin_email}" (id=${userResult.insertId})`);

    return sendSuccess(res, {
      org_id:   orgId,
      admin_id: userResult.insertId,
    }, 'System initialized successfully. You can now log in as Super Admin.');

  } catch (err) {
    console.error('[Setup] initialize error:', err.message);
    if (err.code === 'ER_DUP_ENTRY') {
      return sendError(res, 'Organization code or admin email already exists.', 409);
    }
    return sendError(res, 'Initialization failed. ' + err.message, 500);
  }
};

module.exports = { getStatus, initialize };
