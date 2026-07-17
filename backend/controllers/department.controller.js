// backend/controllers/department.controller.js
'use strict';

const { centralPool, getPool } = require('../services/dbManager');
const { sendSuccess, sendError } = require('../utils/response.util');
const { logAudit }               = require('../utils/auditLogger.util');
const { isSuperAdmin, isUnitAdmin } = require('../middlewares/rbac.middleware');

// ── Public: list departments (no auth — for visitor public form) ───────────────
/**
 * GET /api/departments/public?unit_code=HQ
 * Returns active departments for a given unit (by unit_code).
 * Called by the external visitor prior-approval form.
 */
const listPublicDepartments = async (req, res) => {
  try {
    const { unit_code, unit_id } = req.query;

    let dbPool = null;

    if (unit_code) {
      const [unitRows] = await centralPool.query(
        `SELECT db_name FROM units WHERE code = ? AND is_active = 1 AND db_status = 'ACTIVE'`,
        [unit_code.toUpperCase().trim()]
      );
      if (unitRows.length === 0) return sendError(res, 'Unit not found.', 404);
      dbPool = getPool(unitRows[0].db_name);
    } else if (unit_id) {
      const [unitRows] = await centralPool.query(
        `SELECT db_name FROM units WHERE id = ? AND is_active = 1 AND db_status = 'ACTIVE'`, [unit_id]
      );
      if (unitRows.length === 0) return sendError(res, 'Unit not found.', 404);
      dbPool = getPool(unitRows[0].db_name);
    } else {
      return sendError(res, 'unit_code or unit_id query param is required.', 400);
    }

    const [rows] = await dbPool.query(
      `SELECT id, name, code, description FROM departments WHERE is_active = 1 ORDER BY name ASC`
    );
    return sendSuccess(res, rows, 'Departments fetched successfully.');
  } catch (err) {
    console.error('[DepartmentController] listPublicDepartments error:', err.message);
    return sendError(res, 'Failed to fetch departments.', 500);
  }
};

// ── List Departments (authenticated) ──────────────────────────────────────────
const listDepartments = async (req, res) => {
  try {
    const { search } = req.query;
    const page   = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit  = Math.max(1, parseInt(req.query.limit || '10', 10));
    const offset = (page - 1) * limit;

    const conditions = ['d.is_active = 1'];
    const params     = [];

    if (search && search.trim()) {
      conditions.push('(d.name LIKE ? OR d.code LIKE ?)');
      const like = `%${search.trim()}%`;
      params.push(like, like);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const [[{ total }]] = await req.db.query(
      `SELECT COUNT(*) AS total FROM departments d ${where}`,
      params
    );

    const [rows] = await req.db.query(
      `SELECT d.id, d.name, d.code, d.description, d.is_active, d.created_at,
              d.unit_id,
              COUNT(DISTINCT u.id) AS user_count,
              COUNT(DISTINCT des.id) AS designation_count
       FROM departments d
       LEFT JOIN users u   ON u.department_id = d.id AND u.is_active = 1 AND u.deleted_at IS NULL
       LEFT JOIN designations des ON des.department_id = d.id AND des.is_active = 1
       ${where}
       GROUP BY d.id ORDER BY d.name ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return sendSuccess(res, {
      departments: rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    }, 'Departments fetched successfully.');
  } catch (err) {
    console.error('[DepartmentController] listDepartments error:', err.message);
    return sendError(res, 'Failed to fetch departments.', 500);
  }
};


// ── Create Department ─────────────────────────────────────────────────────────
/**
 * POST /api/departments
 * Body: { name, code, description?, unit_id (required for super_admin), designations?: ['Manager','Engineer'] }
 *
 * If unit_admin: unit_id is taken from req.user.unit_id
 * If super_admin: unit_id must be provided in body
 */
const createDepartment = async (req, res) => {
  try {
    const { name, code, description, unit_id, designations = [] } = req.body;
    if (!name || !code) return sendError(res, 'name and code are required.', 400);

    // For unit_admin: use their own unit_id.
    // For super_admin managing a unit: prefer body unit_id, then fall back to the
    // X-Unit-Id header that the frontend sends whenever activeUnit is set.
    const headerUnitId = req.headers['x-unit-id'] ? parseInt(req.headers['x-unit-id'], 10) : null;
    const effectiveUnitId = isUnitAdmin(req.user)
      ? req.user.unit_id
      : (unit_id || headerUnitId || null);
    if (!effectiveUnitId) return sendError(res, 'unit_id is required — please select a unit to manage first.', 400);

    const conn = await req.db.getConnection();
    try {
      await conn.beginTransaction();

      const [result] = await conn.query(
        `INSERT INTO departments (unit_id, name, code, description, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, NOW(), NOW())`,
        [effectiveUnitId, name, code.toUpperCase().trim(), description || null]
      );
      const deptId = result.insertId;

      // Bulk insert designations if provided
      const createdDesignations = [];
      if (Array.isArray(designations) && designations.length > 0) {
        for (const desName of designations) {
          const trimmed = desName.trim();
          if (!trimmed) continue;
          try {
            const [desResult] = await conn.query(
              `INSERT INTO designations (department_id, name, is_active, created_at, updated_at) VALUES (?, ?, 1, NOW(), NOW())`,
              [deptId, trimmed]
            );
            createdDesignations.push({ id: desResult.insertId, name: trimmed });
          } catch (_) {} // skip duplicates
        }
      }

      await conn.commit();

      await logAudit({
        db:        req.db,
        userId:    req.user.id,
        action:    'CREATE_DEPARTMENT',
        module:    'ADMIN',
        recordType: 'DEPARTMENT',
        recordId:  deptId,
        newValues: { name, code, designation_count: createdDesignations.length },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] || null,
      });

      const [newDept] = await req.db.query('SELECT * FROM departments WHERE id = ?', [deptId]);
      return sendSuccess(res, { ...newDept[0], designations: createdDesignations }, 'Department created successfully.', 201);
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('[DepartmentController] createDepartment error:', err.message);
    if (err.code === 'ER_DUP_ENTRY') return sendError(res, 'A department with this code already exists.', 409);
    return sendError(res, 'Failed to create department.', 500);
  }
};

// ── Update Department ─────────────────────────────────────────────────────────
const updateDepartment = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, description } = req.body;

    const [existing] = await req.db.query('SELECT id FROM departments WHERE id = ?', [id]);
    if (existing.length === 0) return sendError(res, 'Department not found.', 404);

    await req.db.query(
      `UPDATE departments SET
         name        = COALESCE(?, name),
         code        = COALESCE(?, code),
         description = COALESCE(?, description),
         updated_at  = NOW()
       WHERE id = ?`,
      [name || null, code ? code.toUpperCase().trim() : null, description || null, id]
    );

    const [updated] = await req.db.query(
      `SELECT d.*, COUNT(DISTINCT u.id) AS user_count
       FROM departments d
       LEFT JOIN users u ON u.department_id = d.id AND u.is_active = 1
       WHERE d.id = ? GROUP BY d.id`,
      [id]
    );

    await logAudit({
      db:        req.db,
      userId:    req.user.id,
      action:    'UPDATE_DEPARTMENT',
      module:    'ADMIN',
      recordType: 'DEPARTMENT',
      recordId:  parseInt(id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    return sendSuccess(res, updated[0], 'Department updated successfully.');
  } catch (err) {
    console.error('[DepartmentController] updateDepartment error:', err.message);
    if (err.code === 'ER_DUP_ENTRY') return sendError(res, 'A department with this code already exists.', 409);
    return sendError(res, 'Failed to update department.', 500);
  }
};

// ── Deactivate Department ─────────────────────────────────────────────────────
const deactivateDepartment = async (req, res) => {
  try {
    const { id } = req.params;

    const [[deptData]] = await req.db.query(
      `SELECT d.id, COUNT(u.id) AS user_count
       FROM departments d
       LEFT JOIN users u ON u.department_id = d.id AND u.is_active = 1 AND u.deleted_at IS NULL
       WHERE d.id = ? GROUP BY d.id`,
      [id]
    );

    if (!deptData) return sendError(res, 'Department not found.', 404);
    if (deptData.user_count > 0) {
      return sendError(res, `Cannot deactivate — ${deptData.user_count} user(s) are still assigned.`, 409);
    }

    // Suffix the code with _DEL_<id> so the UNIQUE constraint is freed
    // and the same department code can be reused when recreating.
    await req.db.query(
      `UPDATE departments
       SET is_active  = 0,
           code       = CONCAT(code, '_DEL_', id),
           updated_at = NOW()
       WHERE id = ?`,
      [id]
    );
    return sendSuccess(res, { id: parseInt(id) }, 'Department deleted successfully.');
  } catch (err) {
    console.error('[DepartmentController] deactivateDepartment error:', err.message);
    return sendError(res, 'Failed to deactivate department.', 500);
  }
};

module.exports = {
  listPublicDepartments, listDepartments, createDepartment, updateDepartment, deactivateDepartment
};
