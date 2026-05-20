// backend/controllers/department.controller.js
'use strict';

const pool = require('../db');
const { sendSuccess, sendError } = require('../utils/response.util');
const { isOrgAdmin } = require('../middlewares/rbac.middleware');

// ── Public: list departments (no auth — for visitor's dept picker) ─────────────
/**
 * GET /api/departments/public
 * Returns all active departments with minimal info.
 * Called by the external visitor's prior-approval form.
 */
const listPublicDepartments = async (req, res) => {
  try {
    const { organization_id } = req.query;
    let rows;
    if (organization_id) {
      [rows] = await pool.query(
        `SELECT id, name, code, description
         FROM departments
         WHERE is_active = TRUE AND organization_id = ?
         ORDER BY name ASC`,
        [parseInt(organization_id, 10)]
      );
    } else {
      [rows] = await pool.query(
        `SELECT id, name, code, description
         FROM departments
         WHERE is_active = TRUE
         ORDER BY name ASC`
      );
    }
    return sendSuccess(res, rows, 'Departments fetched successfully.');
  } catch (err) {
    console.error('[DepartmentController] listPublicDepartments error:', err.message);
    return sendError(res, 'Failed to fetch departments.', 500);
  }
};

// ── List Departments (authenticated) ──────────────────────────────────────────
const listDepartments = async (req, res) => {
  try {
    let rows;
    if (isOrgAdmin(req.user)) {
      // org_admin sees all departments with user counts
      [rows] = await pool.query(
        `SELECT d.id, d.name, d.code, d.description, d.is_active, d.created_at,
                COUNT(u.id) AS user_count
         FROM departments d
         LEFT JOIN users u ON u.department_id = d.id AND u.is_active = 1 AND u.deleted_at IS NULL
         WHERE d.is_active = TRUE AND d.deleted_at IS NULL
         GROUP BY d.id ORDER BY d.name ASC`
      );
    } else {
      // Other roles only see their own department
      [rows] = await pool.query(
        `SELECT d.id, d.name, d.code, d.description, d.is_active, d.created_at,
                COUNT(u.id) AS user_count
         FROM departments d
         LEFT JOIN users u ON u.department_id = d.id AND u.is_active = 1 AND u.deleted_at IS NULL
         WHERE d.id = ? AND d.is_active = TRUE AND d.deleted_at IS NULL
         GROUP BY d.id`,
        [req.user.department_id]
      );
    }
    return sendSuccess(res, rows, 'Departments fetched successfully.');
  } catch (err) {
    console.error('[DepartmentController] listDepartments error:', err.message);
    return sendError(res, 'Failed to fetch departments.', 500);
  }
};

// ── Create Department ─────────────────────────────────────────────────────────
const createDepartment = async (req, res) => {
  try {
    const { name, code, description, organization_id } = req.body;
    if (!name || !code) return sendError(res, 'name and code are required.', 400);

    const effectiveOrgId = organization_id || req.user.organization_id;

    const [result] = await pool.query(
      `INSERT INTO departments (organization_id, name, code, description, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, TRUE, NOW(), NOW())`,
      [effectiveOrgId, name, code, description || null]
    );

    const [newDept] = await pool.query(
      `SELECT d.id, d.name, d.code, d.description, d.is_active, d.created_at,
              0 AS user_count
       FROM departments d WHERE d.id = ?`,
      [result.insertId]
    );

    return sendSuccess(res, newDept[0], 'Department created successfully.', 201);
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

    const [existing] = await pool.query(`SELECT id FROM departments WHERE id = ? AND deleted_at IS NULL`, [id]);
    if (existing.length === 0) return sendError(res, 'Department not found.', 404);

    await pool.query(
      `UPDATE departments SET name = COALESCE(?, name), code = COALESCE(?, code),
       description = COALESCE(?, description), updated_at = NOW() WHERE id = ?`,
      [name || null, code || null, description || null, id]
    );

    const [updated] = await pool.query(
      `SELECT d.id, d.name, d.code, d.description, d.is_active,
              COUNT(u.id) AS user_count
       FROM departments d
       LEFT JOIN users u ON u.department_id = d.id AND u.is_active = 1
       WHERE d.id = ? GROUP BY d.id`,
      [id]
    );

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
    const [[deptData]] = await pool.query(
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

    await pool.query(`UPDATE departments SET is_active = FALSE, updated_at = NOW() WHERE id = ?`, [id]);
    return sendSuccess(res, { id: parseInt(id) }, 'Department deactivated successfully.');
  } catch (err) {
    console.error('[DepartmentController] deactivateDepartment error:', err.message);
    return sendError(res, 'Failed to deactivate department.', 500);
  }
};

module.exports = { listPublicDepartments, listDepartments, createDepartment, updateDepartment, deactivateDepartment };
