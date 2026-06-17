// backend/controllers/designation.controller.js
'use strict';

const { sendSuccess, sendError } = require('../utils/response.util');
const { logAudit }               = require('../utils/auditLogger.util');

// ── List Designations for a Department ────────────────────────────────────────
/**
 * GET /api/designations?department_id=X
 * Returns all active designations for a given department.
 * Uses req.db (the caller's unit pool).
 */
const listDesignations = async (req, res) => {
  try {
    const { department_id } = req.query;
    if (!department_id) return sendError(res, 'department_id query param is required.', 400);

    const [rows] = await req.db.query(
      `SELECT id, department_id, name, is_active, created_at
       FROM designations
       WHERE department_id = ? AND is_active = 1
       ORDER BY name ASC`,
      [parseInt(department_id, 10)]
    );

    return sendSuccess(res, rows, 'Designations fetched successfully.');
  } catch (err) {
    console.error('[DesignationController] listDesignations error:', err.message);
    return sendError(res, 'Failed to fetch designations.', 500);
  }
};

// ── Bulk Create Designations (called when a department is saved) ──────────────
/**
 * POST /api/designations/bulk
 * Body: { department_id, names: ['Manager', 'Engineer', 'Analyst'] }
 * Creates multiple designations in one call. Skips duplicates.
 */
const bulkCreateDesignations = async (req, res) => {
  try {
    const { department_id, names } = req.body;

    if (!department_id) return sendError(res, 'department_id is required.', 400);
    if (!Array.isArray(names) || names.length === 0) {
      return sendError(res, 'names array is required and must not be empty.', 400);
    }

    // Verify department exists in this unit's DB
    const [deptCheck] = await req.db.query(
      'SELECT id FROM departments WHERE id = ? AND is_active = 1', [department_id]
    );
    if (deptCheck.length === 0) return sendError(res, 'Department not found.', 404);

    const created = [];
    const skipped = [];

    for (const rawName of names) {
      const name = rawName.trim();
      if (!name) continue;

      try {
        const [result] = await req.db.query(
          `INSERT INTO designations (department_id, name, is_active, created_at, updated_at)
           VALUES (?, ?, 1, NOW(), NOW())`,
          [department_id, name]
        );
        created.push({ id: result.insertId, name, department_id });
      } catch (insertErr) {
        if (insertErr.code === 'ER_DUP_ENTRY') {
          skipped.push(name); // already exists — skip
        } else {
          throw insertErr;
        }
      }
    }

    await logAudit({
      db:        req.db,
      userId:    req.user.id,
      action:    'BULK_CREATE_DESIGNATIONS',
      module:    'ADMIN',
      recordType: 'DESIGNATION',
      recordId:  department_id,
      newValues: { created_count: created.length, skipped_count: skipped.length },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    return sendSuccess(res, { created, skipped }, `${created.length} designation(s) created.`, 201);
  } catch (err) {
    console.error('[DesignationController] bulkCreateDesignations error:', err.message);
    return sendError(res, 'Failed to create designations.', 500);
  }
};

// ── Update Designation ────────────────────────────────────────────────────────
const updateDesignation = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name) return sendError(res, 'name is required.', 400);

    const [existing] = await req.db.query('SELECT id FROM designations WHERE id = ?', [id]);
    if (existing.length === 0) return sendError(res, 'Designation not found.', 404);

    await req.db.query(
      'UPDATE designations SET name = ?, updated_at = NOW() WHERE id = ?',
      [name.trim(), id]
    );

    const [updated] = await req.db.query('SELECT * FROM designations WHERE id = ?', [id]);
    return sendSuccess(res, updated[0], 'Designation updated successfully.');
  } catch (err) {
    console.error('[DesignationController] updateDesignation error:', err.message);
    if (err.code === 'ER_DUP_ENTRY') {
      return sendError(res, 'A designation with this name already exists in this department.', 409);
    }
    return sendError(res, 'Failed to update designation.', 500);
  }
};

// ── Deactivate Designation ────────────────────────────────────────────────────
const deactivateDesignation = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if any active user holds this designation
    const [userCheck] = await req.db.query(
      'SELECT COUNT(*) AS cnt FROM users WHERE designation_id = ? AND is_active = 1 AND deleted_at IS NULL',
      [id]
    );
    if (userCheck[0].cnt > 0) {
      return sendError(res, `Cannot deactivate — ${userCheck[0].cnt} active user(s) hold this designation.`, 409);
    }

    await req.db.query('UPDATE designations SET is_active = 0, updated_at = NOW() WHERE id = ?', [id]);
    return sendSuccess(res, { id: parseInt(id) }, 'Designation deactivated successfully.');
  } catch (err) {
    console.error('[DesignationController] deactivateDesignation error:', err.message);
    return sendError(res, 'Failed to deactivate designation.', 500);
  }
};

module.exports = { listDesignations, bulkCreateDesignations, updateDesignation, deactivateDesignation };
