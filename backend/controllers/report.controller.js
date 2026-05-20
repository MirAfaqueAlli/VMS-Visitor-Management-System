// backend/controllers/report.controller.js
'use strict';

const pool = require('../db');
const { sendSuccess, sendError } = require('../utils/response.util');
const { isOrgAdmin } = require('../middlewares/rbac.middleware');

// Helper — builds the dept scope condition for non-org-admin users
const deptCondition = (req, tableAlias = 'vr') => {
  if (isOrgAdmin(req.user)) return { sql: '', params: [] };
  return {
    sql: `${tableAlias}.department_id = ?`,
    params: [req.user.department_id],
  };
};

// GET /api/reports/visitor-summary
const getVisitorSummary = async (req, res) => {
  try {
    const scope = deptCondition(req);
    const where = scope.sql ? `WHERE YEAR(vr.visit_date) = YEAR(CURDATE()) AND ${scope.sql}` : `WHERE YEAR(vr.visit_date) = YEAR(CURDATE())`;
    const [rows] = await pool.query(
      `SELECT MONTH(vr.visit_date) AS month, COUNT(*) AS count
       FROM visit_requests vr ${where}
       GROUP BY MONTH(vr.visit_date) ORDER BY month ASC`,
      scope.params
    );
    return sendSuccess(res, rows, 'Visitor summary fetched.');
  } catch (err) {
    console.error('[ReportController] getVisitorSummary error:', err.message);
    return sendError(res, 'Failed to fetch visitor summary.', 500);
  }
};

// GET /api/reports/by-status?from=YYYY-MM-DD&to=YYYY-MM-DD&department_id=X
const getByStatus = async (req, res) => {
  try {
    const { from, to, department_id } = req.query;
    const conditions = [];
    const params = [];
    if (from) { conditions.push('visit_date >= ?'); params.push(from); }
    if (to)   { conditions.push('visit_date <= ?'); params.push(to); }
    // Dept scope
    if (isOrgAdmin(req.user) && department_id) {
      conditions.push('department_id = ?');
      params.push(department_id);
    } else if (!isOrgAdmin(req.user)) {
      conditions.push('department_id = ?');
      params.push(req.user.department_id);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT status, COUNT(*) AS count FROM visit_requests ${where} GROUP BY status`,
      params
    );
    return sendSuccess(res, rows, 'Status breakdown fetched.');
  } catch (err) {
    console.error('[ReportController] getByStatus error:', err.message);
    return sendError(res, 'Failed to fetch status breakdown.', 500);
  }
};

// GET /api/reports/by-department?from=YYYY-MM-DD&to=YYYY-MM-DD
// org_admin: full org breakdown by dept; dept_admin: only their dept
const getByDepartment = async (req, res) => {
  try {
    const { from, to } = req.query;
    const conditions = [];
    const params = [];
    if (from) { conditions.push('vr.visit_date >= ?'); params.push(from); }
    if (to)   { conditions.push('vr.visit_date <= ?'); params.push(to); }
    if (!isOrgAdmin(req.user)) {
      conditions.push('vr.department_id = ?');
      params.push(req.user.department_id);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT d.name AS department_name, COUNT(vr.id) AS visit_count
       FROM visit_requests vr
       JOIN departments d ON d.id = vr.department_id
       ${where}
       GROUP BY d.id ORDER BY visit_count DESC`,
      params
    );
    return sendSuccess(res, rows, 'Department breakdown fetched.');
  } catch (err) {
    console.error('[ReportController] getByDepartment error:', err.message);
    return sendError(res, 'Failed to fetch department breakdown.', 500);
  }
};

// GET /api/reports/visitor-type?from=YYYY-MM-DD&to=YYYY-MM-DD
const getByVisitorType = async (req, res) => {
  try {
    const { from, to } = req.query;
    const conditions = [];
    const params = [];
    if (from) { conditions.push('visit_date >= ?'); params.push(from); }
    if (to)   { conditions.push('visit_date <= ?'); params.push(to); }
    if (!isOrgAdmin(req.user)) {
      conditions.push('department_id = ?');
      params.push(req.user.department_id);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT visit_category AS category, COUNT(*) AS count FROM visit_requests ${where} GROUP BY visit_category`,
      params
    );
    return sendSuccess(res, rows, 'Visitor type breakdown fetched.');
  } catch (err) {
    console.error('[ReportController] getByVisitorType error:', err.message);
    return sendError(res, 'Failed to fetch visitor type breakdown.', 500);
  }
};

module.exports = { getVisitorSummary, getByStatus, getByDepartment, getByVisitorType };
