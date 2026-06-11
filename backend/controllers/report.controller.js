// backend/controllers/report.controller.js
'use strict';

const { sendSuccess, sendError } = require('../utils/response.util');
const { isSuperAdmin, isUnitAdmin, isDeptAdmin, isGlobalAuditor, isAnyAuditor } = require('../middlewares/rbac.middleware');

const getISTDateString = (d = new Date()) => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
};


// ── Scope helper ────────────────────────────────────────────────────────────────────────────────
/**
 * Returns a WHERE fragment + params that scopes the query to the caller's dept
 * if they are not a super/unit admin. req.db is already scoped to the unit.
 */
const deptScope = (req, tableAlias = 'vr') => {
  if (isSuperAdmin(req.user) || isUnitAdmin(req.user) || isAnyAuditor(req.user)) return { sql: '', params: [] };
  return {
    sql:    `${tableAlias}.department_id = ?`,
    params: [req.user.department_id],
  };
};

// ── GET /api/reports/visitor-summary ────────────────────────────────────────
/**
 * Monthly visitor count for the current year + aggregate stats for stat cards.
 * Returns: { monthly: [{month, count}], total, approved, pending, rejected }
 */
const getVisitorSummary = async (req, res) => {
  try {
    const isCentral = isSuperAdmin(req.user) || isGlobalAuditor(req.user);

    if (isCentral) {
      const { queryAllUnits } = require('../services/dbManager');
      const [fanned, statsFanned] = await Promise.all([
        queryAllUnits(
          `SELECT MONTH(visit_date) AS month, COUNT(*) AS count
           FROM visit_requests
           WHERE YEAR(visit_date) = YEAR(CURDATE())
           GROUP BY MONTH(visit_date)`
        ),
        queryAllUnits(
          `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS approved,
             SUM(CASE WHEN status = 'PENDING'  THEN 1 ELSE 0 END) AS pending,
             SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected
           FROM visit_requests`
        ),
      ]);
      const aggregated = {};
      for (const r of fanned) {
        for (const row of r.rows) {
          const month = Number(row.month);
          aggregated[month] = (aggregated[month] || 0) + Number(row.count);
        }
      }
      const monthly = Object.entries(aggregated).map(([month, count]) => ({ month: Number(month), count }));
      let total = 0, approved = 0, pending = 0, rejected = 0;
      for (const r of statsFanned) {
        for (const row of r.rows) {
          total    += Number(row.total    || 0);
          approved += Number(row.approved || 0);
          pending  += Number(row.pending  || 0);
          rejected += Number(row.rejected || 0);
        }
      }
      return sendSuccess(res, { monthly, total, approved, pending, rejected }, 'Visitor summary fetched.');
    }

    const scope = deptScope(req);
    const yearWhere = scope.sql
      ? `WHERE YEAR(vr.visit_date) = YEAR(CURDATE()) AND ${scope.sql}`
      : `WHERE YEAR(vr.visit_date) = YEAR(CURDATE())`;
    const allWhere = scope.sql ? `WHERE ${scope.sql}` : '';

    const [[monthly], [[stats]]] = await Promise.all([
      req.db.query(
        `SELECT MONTH(vr.visit_date) AS month, COUNT(*) AS count
         FROM visit_requests vr ${yearWhere}
         GROUP BY MONTH(vr.visit_date) ORDER BY month ASC`,
        scope.params
      ),
      req.db.query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN vr.status = 'APPROVED' THEN 1 ELSE 0 END) AS approved,
           SUM(CASE WHEN vr.status = 'PENDING'  THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN vr.status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected
         FROM visit_requests vr ${allWhere}`,
        scope.params
      ),
    ]);

    return sendSuccess(res, {
      monthly,
      total:    Number(stats.total    || 0),
      approved: Number(stats.approved || 0),
      pending:  Number(stats.pending  || 0),
      rejected: Number(stats.rejected || 0),
    }, 'Visitor summary fetched.');
  } catch (err) {
    console.error('[ReportController] getVisitorSummary error:', err.message);
    return sendError(res, 'Failed to fetch visitor summary.', 500);
  }
};

// â”€â”€ GET /api/reports/by-status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * Count of visits grouped by status.
 * Query params: from, to, department_id (admin only)
 */
const getByStatus = async (req, res) => {
  try {
    const { from, to } = req.query;
    const isCentral = isSuperAdmin(req.user) || isGlobalAuditor(req.user);

    if (isCentral) {
      const { queryAllUnits } = require('../services/dbManager');
      const conditions = [];
      const params     = [];
      if (from) { conditions.push('visit_date >= ?'); params.push(from); }
      if (to)   { conditions.push('visit_date <= ?'); params.push(to); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const fanned = await queryAllUnits(
        `SELECT status, COUNT(*) AS count FROM visit_requests ${where} GROUP BY status`,
        params
      );
      const aggregated = {};
      for (const res of fanned) {
        for (const row of res.rows) {
          const status = row.status;
          aggregated[status] = (aggregated[status] || 0) + Number(row.count);
        }
      }
      const rows = Object.entries(aggregated).map(([status, count]) => ({ status, count }));
      return sendSuccess(res, rows, 'Status breakdown fetched.');
    }

    const { department_id } = req.query;
    const conditions = [];
    const params     = [];

    if (from) { conditions.push('visit_date >= ?'); params.push(from); }
    if (to)   { conditions.push('visit_date <= ?'); params.push(to); }

    if (isSuperAdmin(req.user) || isUnitAdmin(req.user) || isAnyAuditor(req.user)) {
      // Admin: allow optional dept filter
      if (department_id) { conditions.push('department_id = ?'); params.push(department_id); }
    } else {
      // Non-admin: always scope to own dept
      conditions.push('department_id = ?');
      params.push(req.user.department_id);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await req.db.query(
      `SELECT status, COUNT(*) AS count FROM visit_requests ${where} GROUP BY status`,
      params
    );

    return sendSuccess(res, rows, 'Status breakdown fetched.');
  } catch (err) {
    console.error('[ReportController] getByStatus error:', err.message);
    return sendError(res, 'Failed to fetch status breakdown.', 500);
  }
};

// â”€â”€ GET /api/reports/by-department â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * Visits grouped by department.
 * Query params: from, to
 */
const getByDepartment = async (req, res) => {
  try {
    const { from, to } = req.query;
    const isCentral = isSuperAdmin(req.user) || isGlobalAuditor(req.user);

    if (isCentral) {
      const { queryAllUnits } = require('../services/dbManager');
      const conditions = [];
      const params     = [];
      if (from) { conditions.push('vr.visit_date >= ?'); params.push(from); }
      if (to)   { conditions.push('vr.visit_date <= ?'); params.push(to); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const fanned = await queryAllUnits(
        `SELECT d.name AS department_name, COUNT(vr.id) AS visit_count
         FROM visit_requests vr
         JOIN departments d ON d.id = vr.department_id
         ${where}
         GROUP BY d.id`,
        params
      );
      const aggregated = {};
      for (const res of fanned) {
        for (const row of res.rows) {
          const deptName = row.department_name;
          aggregated[deptName] = (aggregated[deptName] || 0) + Number(row.visit_count);
        }
      }
      const rows = Object.entries(aggregated)
        .map(([department_name, visit_count]) => ({ department_name, visit_count }))
        .sort((a, b) => b.visit_count - a.visit_count);
      return sendSuccess(res, rows, 'Department breakdown fetched.');
    }

    const conditions   = [];
    const params       = [];

    if (from) { conditions.push('vr.visit_date >= ?'); params.push(from); }
    if (to)   { conditions.push('vr.visit_date <= ?'); params.push(to); }

    if (!isSuperAdmin(req.user) && !isUnitAdmin(req.user) && !isAnyAuditor(req.user)) {
      conditions.push('vr.department_id = ?');
      params.push(req.user.department_id);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await req.db.query(
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

// â”€â”€ GET /api/reports/visitor-type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * Visits grouped by visit_category (EMPLOYEE_VISIT, VENDOR, SPOT, PERSONAL_VISIT)
 */
const getByVisitorType = async (req, res) => {
  try {
    const { from, to } = req.query;
    const isCentral = isSuperAdmin(req.user) || isGlobalAuditor(req.user);

    if (isCentral) {
      const { queryAllUnits } = require('../services/dbManager');
      const conditions = [];
      const params     = [];
      if (from) { conditions.push('visit_date >= ?'); params.push(from); }
      if (to)   { conditions.push('visit_date <= ?'); params.push(to); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const fanned = await queryAllUnits(
        `SELECT visit_category AS category, COUNT(*) AS count
         FROM visit_requests ${where}
         GROUP BY visit_category`,
        params
      );
      const aggregated = {};
      for (const res of fanned) {
        for (const row of res.rows) {
          const category = row.category;
          aggregated[category] = (aggregated[category] || 0) + Number(row.count);
        }
      }
      const rows = Object.entries(aggregated).map(([category, count]) => ({ category, count }));
      return sendSuccess(res, rows, 'Visitor type breakdown fetched.');
    }

    const conditions   = [];
    const params       = [];

    if (from) { conditions.push('visit_date >= ?'); params.push(from); }
    if (to)   { conditions.push('visit_date <= ?'); params.push(to); }

    if (!isSuperAdmin(req.user) && !isUnitAdmin(req.user) && !isAnyAuditor(req.user)) {
      conditions.push('department_id = ?');
      params.push(req.user.department_id);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await req.db.query(
      `SELECT visit_category AS category, COUNT(*) AS count
       FROM visit_requests ${where}
       GROUP BY visit_category`,
      params
    );

    return sendSuccess(res, rows, 'Visitor type breakdown fetched.');
  } catch (err) {
    console.error('[ReportController] getByVisitorType error:', err.message);
    return sendError(res, 'Failed to fetch visitor type breakdown.', 500);
  }
};

// â”€â”€ GET /api/reports/daily-traffic â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * Day-by-day visit counts for a date range. Useful for charts.
 * Query params: from (required), to (optional, defaults to today)
 */
const getDailyTraffic = async (req, res) => {
  try {
    let { from, to } = req.query;
    // Default: last 30 days if no from date provided
    if (!from) {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      from = getISTDateString(d);
    }

    const isCentral = isSuperAdmin(req.user) || isGlobalAuditor(req.user);

    if (isCentral) {
      const { queryAllUnits } = require('../services/dbManager');
      const conditions = ['vr.visit_date >= ?'];
      const params     = [from];
      if (to) { conditions.push('vr.visit_date <= ?'); params.push(to); }
      const where = `WHERE ${conditions.join(' AND ')}`;

      const fanned = await queryAllUnits(
        `SELECT vr.visit_date AS date,
                COUNT(*) AS total,
                SUM(CASE WHEN vr.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN vr.status = 'PENDING'   THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN vr.status = 'REJECTED'  THEN 1 ELSE 0 END) AS rejected,
                SUM(CASE WHEN vr.status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled
         FROM visit_requests vr
         ${where}
         GROUP BY vr.visit_date`,
        params
      );
      const aggregated = {};
      for (const res of fanned) {
        for (const row of res.rows) {
          const date = row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date);
          if (!aggregated[date]) {
            aggregated[date] = { date, total: 0, completed: 0, pending: 0, rejected: 0, cancelled: 0 };
          }
          aggregated[date].total     += Number(row.total);
          aggregated[date].completed += Number(row.completed);
          aggregated[date].pending   += Number(row.pending);
          aggregated[date].rejected  += Number(row.rejected);
          aggregated[date].cancelled += Number(row.cancelled);
        }
      }
      const rows = Object.values(aggregated).sort((a, b) => a.date.localeCompare(b.date));
      return sendSuccess(res, rows, 'Daily traffic fetched.');
    }

    const conditions = ['vr.visit_date >= ?'];
    const params     = [from];

    if (to) { conditions.push('vr.visit_date <= ?'); params.push(to); }

    if (!isSuperAdmin(req.user) && !isUnitAdmin(req.user) && !isAnyAuditor(req.user)) {
      conditions.push('vr.department_id = ?');
      params.push(req.user.department_id);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const [rows] = await req.db.query(
      `SELECT vr.visit_date AS date,
              COUNT(*) AS total,
              SUM(CASE WHEN vr.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN vr.status = 'PENDING'   THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN vr.status = 'REJECTED'  THEN 1 ELSE 0 END) AS rejected,
              SUM(CASE WHEN vr.status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled
       FROM visit_requests vr
       ${where}
       GROUP BY vr.visit_date
       ORDER BY vr.visit_date ASC`,
      params
    );

    return sendSuccess(res, rows, 'Daily traffic fetched.');
  } catch (err) {
    console.error('[ReportController] getDailyTraffic error:', err.message);
    return sendError(res, 'Failed to fetch daily traffic.', 500);
  }
};

// â”€â”€ GET /api/reports/top-hosts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * Top hosts by number of visits (within a date range).
 */
const getTopHosts = async (req, res) => {
  try {
    const { from, to, limit = 10 } = req.query;
    const parsedLimit = Math.min(50, parseInt(limit, 10) || 10);

    const isCentral = isSuperAdmin(req.user) || isGlobalAuditor(req.user);

    if (isCentral) {
      const { queryAllUnits } = require('../services/dbManager');
      const conditions  = [];
      const params      = [];
      if (from) { conditions.push('vr.visit_date >= ?'); params.push(from); }
      if (to)   { conditions.push('vr.visit_date <= ?'); params.push(to); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const fanned = await queryAllUnits(
        `SELECT h.full_name, h.designation, d.name AS department_name,
                COUNT(vr.id) AS visit_count
         FROM visit_requests vr
         JOIN users h ON h.id = vr.host_user_id
         LEFT JOIN departments d ON d.id = vr.department_id
         ${where}
         GROUP BY h.full_name, h.designation, d.name`,
        params
      );
      const aggregated = {};
      for (const res of fanned) {
        for (const row of res.rows) {
          const key = `${row.full_name}||${row.department_name}`;
          if (!aggregated[key]) {
            aggregated[key] = {
              full_name:       row.full_name,
              designation:     row.designation,
              department_name: row.department_name,
              visit_count:     0,
            };
          }
          aggregated[key].visit_count += Number(row.visit_count);
        }
      }
      const rows = Object.values(aggregated)
        .sort((a, b) => b.visit_count - a.visit_count)
        .slice(0, parsedLimit);
      return sendSuccess(res, rows, 'Top hosts fetched.');
    }

    const conditions  = [];
    const params      = [];

    if (from) { conditions.push('vr.visit_date >= ?'); params.push(from); }
    if (to)   { conditions.push('vr.visit_date <= ?'); params.push(to); }

    if (!isSuperAdmin(req.user) && !isUnitAdmin(req.user) && !isAnyAuditor(req.user)) {
      conditions.push('vr.department_id = ?');
      params.push(req.user.department_id);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows] = await req.db.query(
      `SELECT h.id, h.full_name, h.designation, d.name AS department_name,
              COUNT(vr.id) AS visit_count
       FROM visit_requests vr
       JOIN users h ON h.id = vr.host_user_id
       LEFT JOIN departments d ON d.id = vr.department_id
       ${where}
       GROUP BY h.id, h.full_name, h.designation, d.name
       ORDER BY visit_count DESC
       LIMIT ?`,
      [...params, parsedLimit]
    );

    return sendSuccess(res, rows, 'Top hosts fetched.');
  } catch (err) {
    console.error('[ReportController] getTopHosts error:', err.message);
    return sendError(res, 'Failed to fetch top hosts.', 500);
  }
};

// â”€â”€ GET /api/reports/audit-logs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * Returns unit-level audit logs. Accessible by unit_admin, unit_auditor, dept_admin.
 * super_admin and global_auditor should use /audit-logs/global instead.
 */
const getUnitAuditLogs = async (req, res) => {
  try {
    // Central users must use the global endpoint
    if (isSuperAdmin(req.user) || isGlobalAuditor(req.user)) {
      return res.redirect(307, '/api/reports/audit-logs/global?' + new URLSearchParams(req.query).toString());
    }

    const db = req.db;
    if (!db) return sendError(res, 'Unit DB not available.', 400);

    const page   = Math.max(1, parseInt(req.query.page  || '1'));
    const limit  = Math.min(100, parseInt(req.query.limit || '20'));
    const offset = (page - 1) * limit;
    const search = req.query.search?.trim();
    const module = req.query.module?.trim();

    let where = '1=1';
    const params = [];

    if (search) {
      where += ' AND (ual.action LIKE ? OR ual.module LIKE ? OR ual.record_type LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (module) {
      where += ' AND ual.module = ?';
      params.push(module);
    }

    const [rows] = await db.query(`
      SELECT ual.*, u.full_name AS user_name
      FROM audit_logs ual
      LEFT JOIN users u ON u.id = ual.user_id
      WHERE ${where}
      ORDER BY ual.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM audit_logs ual WHERE ${where}`,
      params
    );

    return sendSuccess(res, {
      logs: rows,
      pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) },
    });
  } catch (err) {
    console.error('[ReportController] getUnitAuditLogs error:', err.message);
    return sendError(res, 'Failed to fetch audit logs.', 500);
  }
};

// â”€â”€ GET /api/reports/audit-logs/global â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * Returns a combined audit log view for super_admin / global_auditor:
 *  1. vms_central.global_audit_logs  (central admin actions)
 *  2. Every active unit DB's audit_logs  (all unit-level actions)
 *
 * Supports: search, module filter, unit_db filter, pagination.
 * All filtering is done before merging to avoid pulling millions of rows.
 */
const getGlobalAuditLogs = async (req, res) => {
  try {
    const { centralPool, getPool } = require('../services/dbManager');

    const page       = Math.max(1, parseInt(req.query.page   || '1'));
    const limit      = Math.min(100, parseInt(req.query.limit || '20'));
    const offset     = (page - 1) * limit;
    const search     = req.query.search?.trim();
    const moduleFilter = req.query.module?.trim();
    const unitDbFilter = req.query.unit_db?.trim(); // optional: scope to one unit

    // â”€â”€ Build reusable WHERE fragments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const buildWhere = (alias) => {
      const conditions = [];
      const params = [];
      if (search) {
        conditions.push(`(${alias}.action LIKE ? OR ${alias}.module LIKE ? OR ${alias}.record_type LIKE ?)`);
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      if (moduleFilter) {
        conditions.push(`${alias}.module = ?`);
        params.push(moduleFilter);
      }
      return {
        where:  conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
        params,
      };
    };

    // â”€â”€ Collect all rows from all sources â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let allRows = [];

    // 1. Central global_audit_logs (super admin own actions)
    if (!unitDbFilter || unitDbFilter === 'central') {
      const { where, params } = buildWhere('gal');
      const [centralRows] = await centralPool.query(
        `SELECT gal.id, gal.user_id, gal.source_unit AS unit_db,
                'Central Admin' AS unit_name,
                gal.action, gal.module, gal.record_type, gal.record_id,
                gal.old_values, gal.new_values,
                gal.ip_address, gal.user_agent, gal.created_at,
                u.full_name AS user_name,
                'central' AS log_source
         FROM global_audit_logs gal
         LEFT JOIN users u ON u.id = gal.user_id
         ${where}
         ORDER BY gal.created_at DESC
         LIMIT 2000`,  // cap per-source to avoid memory explosion
        params
      );
      allRows = allRows.concat(centralRows);
    }

    // 2. Each active unit DB's audit_logs
    const [units] = await centralPool.query(
      `SELECT db_name, name AS unit_name FROM units WHERE is_active = 1 AND db_status = 'ACTIVE'`
    );

    const unitFetches = units
      .filter(u => !unitDbFilter || unitDbFilter === u.db_name)
      .map(async (unit) => {
        try {
          const pool = getPool(unit.db_name);
          const { where, params } = buildWhere('al');
          const [rows] = await pool.query(
            `SELECT al.id, al.user_id,
                    '${unit.db_name}' AS unit_db,
                    '${unit.unit_name.replace(/'/g, "''")}' AS unit_name,
                    al.action, al.module, al.record_type, al.record_id,
                    al.old_values, al.new_values,
                    al.ip_address, al.user_agent, al.created_at,
                    u.full_name AS user_name,
                    'unit' AS log_source
             FROM audit_logs al
             LEFT JOIN users u ON u.id = al.user_id
             ${where}
             ORDER BY al.created_at DESC
             LIMIT 2000`,
            params
          );
          return rows;
        } catch (unitErr) {
          console.warn(`[GlobalAuditLog] Skipping unit ${unit.db_name}:`, unitErr.message);
          return [];
        }
      });

    const unitResults = await Promise.allSettled(unitFetches);
    for (const r of unitResults) {
      if (r.status === 'fulfilled') allRows = allRows.concat(r.value);
    }

    // â”€â”€ Sort merged results by created_at DESC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    allRows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // â”€â”€ Paginate in-memory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const total      = allRows.length;
    const pages      = Math.max(1, Math.ceil(total / limit));
    const pageSlice  = allRows.slice(offset, offset + limit);

    return sendSuccess(res, {
      logs:       pageSlice,
      units:      units.map(u => ({ db_name: u.db_name, unit_name: u.unit_name })),
      pagination: { page, limit, total, pages },
    });
  } catch (err) {
    console.error('[ReportController] getGlobalAuditLogs error:', err.message);
    return sendError(res, 'Failed to fetch global audit logs.', 500);
  }
};

// â”€â”€ GET /api/reports/global-summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * Returns cross-unit aggregate stats for super admin dashboard / reports.
 * Includes: unit counts, total/month/today visits, currently inside, pending approvals.
 */
const getGlobalSummary = async (req, res) => {
  try {
    const { centralPool, getPool } = require('../services/dbManager');

    // All active units (include suspended count separately)
    const [allUnits]    = await centralPool.query(`SELECT id, db_name, db_status FROM units WHERE is_active = 1`);
    const activeUnits   = allUnits.filter(u => u.db_status === 'ACTIVE');
    const totalUnits    = allUnits.length;
    const provUnits     = allUnits.filter(u => u.db_status !== 'ACTIVE').length;
    const today         = getISTDateString();
    const thisMonth     = today.slice(0, 7); // YYYY-MM

    let totalVisits      = 0;
    let thisMonthVisits  = 0;
    let todayVisits      = 0;
    let currentlyInside  = 0;
    let pendingApprovals = 0;

    await Promise.all(activeUnits.map(async (unit) => {
      try {
        const db = getPool(unit.db_name);
        const [
          [totRow],
          [mthRow],
          [todayRow],
          [insideRow],
          [pendRow],
        ] = await Promise.all([
          db.query(`SELECT COUNT(*) AS cnt FROM visit_requests`),
          db.query(`SELECT COUNT(*) AS cnt FROM visit_requests WHERE DATE_FORMAT(created_at,'%Y-%m') = ?`, [thisMonth]),
          db.query(`SELECT COUNT(*) AS cnt FROM visit_requests WHERE visit_date = ?`, [today]),
          db.query(`SELECT COUNT(*) AS cnt FROM visit_logs WHERE status = 'ACTIVE'`),
          db.query(`SELECT COUNT(*) AS cnt FROM visit_requests WHERE status = 'PENDING'`),
        ]);
        totalVisits      += Number(totRow[0].cnt);
        thisMonthVisits  += Number(mthRow[0].cnt);
        todayVisits      += Number(todayRow[0].cnt);
        currentlyInside  += Number(insideRow[0].cnt);
        pendingApprovals += Number(pendRow[0].cnt);
      } catch { /* DB may be provisioning â€” skip silently */ }
    }));

    return sendSuccess(res, {
      total_units:        totalUnits,
      active_units:       activeUnits.length,
      provisioning_units: provUnits,
      total_visits:       totalVisits,
      this_month_visits:  thisMonthVisits,
      today_visits:       todayVisits,
      currently_inside:   currentlyInside,
      pending_approvals:  pendingApprovals,
    });
  } catch (err) {
    console.error('[ReportController] getGlobalSummary error:', err.message);
    return sendError(res, 'Failed to fetch global summary.', 500);
  }
};

// â”€â”€ GET /api/reports/global-recent-visits â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * Returns the most recent visit requests across all active unit DBs,
 * tagged with the originating unit name. Used by super admin dashboard table.
 */
const getGlobalRecentVisits = async (req, res) => {
  try {
    const { centralPool, getPool } = require('../services/dbManager');
    const limit = Math.min(50, parseInt(req.query.limit || '15', 10));

    const [units] = await centralPool.query(
      `SELECT db_name, name AS unit_name FROM units WHERE db_status = 'ACTIVE' AND is_active = 1`
    );

    const fetches = units.map(async (unit) => {
      try {
        const db = getPool(unit.db_name);
        const [rows] = await db.query(
          `SELECT vr.id, vr.visitor_name, vr.visitor_phone, vr.visit_date,
                  vr.visit_start_time, vr.status, vr.visit_category,
                  vr.purpose, vr.created_at,
                  h.full_name AS host_name,
                  d.name      AS department_name
           FROM visit_requests vr
           LEFT JOIN users       h ON h.id = vr.host_user_id
           LEFT JOIN departments d ON d.id = vr.department_id
           ORDER BY vr.created_at DESC
           LIMIT ?`,
          [limit]
        );
        return rows.map(r => ({ ...r, unit_name: unit.unit_name, unit_db: unit.db_name }));
      } catch { return []; }
    });

    const results = await Promise.allSettled(fetches);
    let allRows = [];
    for (const r of results) {
      if (r.status === 'fulfilled') allRows = allRows.concat(r.value);
    }

    // Sort merged list newest-first, then slice to global limit
    allRows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const recentVisits = allRows.slice(0, limit);

    return sendSuccess(res, recentVisits, 'Recent visits fetched.');
  } catch (err) {
    console.error('[ReportController] getGlobalRecentVisits error:', err.message);
    return sendError(res, 'Failed to fetch recent visits.', 500);
  }
};

// ── Shared query builder helper ──────────────────────────────────────────────
const buildDateWhere = (conditions, params, from, to, alias = 'vr') => {
  if (from) { conditions.push(`${alias}.visit_date >= ?`); params.push(from); }
  if (to)   { conditions.push(`${alias}.visit_date <= ?`); params.push(to); }
};

// Helper: get pool + unit name for a specific unit_db
const getScopedUnit = async (unit_db) => {
  const { getPool, centralPool } = require('../services/dbManager');
  const pool = getPool(unit_db);
  const [[unitRow]] = await centralPool.query('SELECT name FROM units WHERE db_name = ?', [unit_db]);
  return { pool, unitName: unitRow?.name ?? unit_db };
};

// â”€â”€ GET /api/reports/meta/units â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/** List of active units â€” for global users to populate the Unit dropdown. */
const getMetaUnits = async (req, res) => {
  try {
    const { centralPool } = require('../services/dbManager');
    const [units] = await centralPool.query(
      "SELECT id, name, db_name FROM units WHERE is_active = 1 AND db_status = 'ACTIVE' ORDER BY name ASC"
    );
    return sendSuccess(res, units);
  } catch (err) {
    console.error('[ReportMeta] getMetaUnits error:', err.message);
    return sendError(res, 'Failed to fetch units.', 500);
  }
};

// â”€â”€ GET /api/reports/meta/departments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/** Departments list. Global users pass ?unit_db= to target a specific unit DB. */
const getMetaDepartments = async (req, res) => {
  try {
    const { unit_db } = req.query;
    const isCentral = isSuperAdmin(req.user) || isGlobalAuditor(req.user);

    let db = req.db;
    if (isCentral && unit_db) {
      const { getPool } = require('../services/dbManager');
      db = getPool(unit_db);
    } else if (isCentral && !unit_db) {
      return sendSuccess(res, []); // no unit selected yet
    }
    if (!db) return sendSuccess(res, []);

    const [rows] = await db.query('SELECT id, name FROM departments ORDER BY name ASC');
    return sendSuccess(res, rows);
  } catch (err) {
    console.error('[ReportMeta] getMetaDepartments error:', err.message);
    return sendError(res, 'Failed to fetch departments.', 500);
  }
};

// â”€â”€ GET /api/reports/meta/employees â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/** Employee list for dropdown. Global users pass ?unit_db=. Optional ?department_id=. */
const getMetaEmployees = async (req, res) => {
  try {
    const { unit_db, department_id } = req.query;
    const isCentral = isSuperAdmin(req.user) || isGlobalAuditor(req.user);

    let db = req.db;
    if (isCentral && unit_db) {
      const { getPool } = require('../services/dbManager');
      db = getPool(unit_db);
    } else if (isCentral && !unit_db) {
      return sendSuccess(res, []);
    }
    if (!db) return sendSuccess(res, []);

    const conditions = [`is_active = 1`, `deleted_at IS NULL`, `role_type = 'employee'`];
    const params = [];
    if (department_id) { conditions.push('department_id = ?'); params.push(department_id); }

    const [rows] = await db.query(
      `SELECT id, full_name, employee_code, department_id FROM users WHERE ${conditions.join(' AND ')} ORDER BY full_name ASC`,
      params
    );
    return sendSuccess(res, rows);
  } catch (err) {
    console.error('[ReportMeta] getMetaEmployees error:', err.message);
    return sendError(res, 'Failed to fetch employees.', 500);
  }
};

// â”€â”€ GET /api/reports/employee-wise â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * unit_admin / unit_auditor â†’ filter by dept_id and/or host_user_id within their unit.
 * super_admin / global_auditor:
 *   - with unit_db â†’ scoped to that unit, dept_id + host_user_id filters work
 *   - without unit_db â†’ fans out across all units (date/type/search only)
 */
const getEmployeeWiseReport = async (req, res) => {
  try {
    const { from, to, visitor_type, search, department_id, host_user_id, unit_db, page = 1, limit = 50 } = req.query;
    const parsedLimit  = Math.min(200, parseInt(limit, 10) || 50);
    const parsedOffset = (Math.max(1, parseInt(page, 10)) - 1) * parsedLimit;
    const isCentral = isSuperAdmin(req.user) || isGlobalAuditor(req.user);

    const buildConditions = () => {
      const conditions = [];
      const params     = [];
      buildDateWhere(conditions, params, from, to);
      if (visitor_type)  { conditions.push('vr.visit_category = ?'); params.push(visitor_type); }
      if (department_id) { conditions.push('vr.department_id = ?');  params.push(department_id); }
      if (host_user_id)  { conditions.push('vr.host_user_id = ?');   params.push(host_user_id); }
      if (search) {
        conditions.push('(vr.visitor_name LIKE ? OR h.full_name LIKE ? OR vr.visitor_phone LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      return { conditions, params };
    };

    const SELECT = `
      SELECT
        vr.id, vr.visitor_name, vr.visitor_phone, vr.visitor_email,
        vr.visit_date, vr.visit_start_time, vr.visit_end_time,
        vr.visit_category, vr.purpose, vr.status,
        h.id AS host_id, h.full_name AS host_name, h.employee_code,
        d.name AS department_name,
        vr.created_at
      FROM visit_requests vr
      LEFT JOIN users h ON h.id = vr.host_user_id
      LEFT JOIN departments d ON d.id = vr.department_id`;

    if (isCentral) {
      const { queryAllUnits } = require('../services/dbManager');
      const { conditions, params } = buildConditions();
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      if (unit_db) {
        const { pool, unitName } = await getScopedUnit(unit_db);
        const [[{ total }]] = await pool.query(
          `SELECT COUNT(*) AS total FROM visit_requests vr LEFT JOIN users h ON h.id = vr.host_user_id LEFT JOIN departments d ON d.id = vr.department_id ${where}`, params
        );
        const [rows] = await pool.query(`${SELECT} ${where} ORDER BY vr.visit_date DESC LIMIT ? OFFSET ?`, [...params, parsedLimit, parsedOffset]);
        return sendSuccess(res, { rows: rows.map(r => ({ ...r, unit_name: unitName })), total: Number(total), page: parseInt(page), limit: parsedLimit });
      }
      // Fan-out (no dept/employee filter)
      const fanned = await queryAllUnits(`${SELECT} ${where} ORDER BY vr.visit_date DESC`, params);
      let rows = [];
      for (const r of fanned) rows = rows.concat(r.rows.map(row => ({ ...row, unit_name: r.unit_name })));
      rows.sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date));
      return sendSuccess(res, { rows: rows.slice(parsedOffset, parsedOffset + parsedLimit), total: rows.length, page: parseInt(page), limit: parsedLimit });
    }

    // Unit-level
    const { conditions, params } = buildConditions();
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [[{ total }]] = await req.db.query(
      `SELECT COUNT(*) AS total FROM visit_requests vr LEFT JOIN users h ON h.id = vr.host_user_id LEFT JOIN departments d ON d.id = vr.department_id ${where}`, params
    );
    const [rows] = await req.db.query(`${SELECT} ${where} ORDER BY vr.visit_date DESC LIMIT ? OFFSET ?`, [...params, parsedLimit, parsedOffset]);
    return sendSuccess(res, { rows, total: Number(total), page: parseInt(page), limit: parsedLimit });
  } catch (err) {
    console.error('[ReportController] getEmployeeWiseReport error:', err.message);
    return sendError(res, 'Failed to fetch employee-wise report.', 500);
  }
};

// â”€â”€ GET /api/reports/department-wise â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const getDepartmentWiseReport = async (req, res) => {
  try {
    const { from, to, visitor_type, department_id, unit_db, search, page = 1, limit = 50 } = req.query;
    const parsedLimit  = Math.min(200, parseInt(limit, 10) || 50);
    const parsedOffset = (Math.max(1, parseInt(page, 10)) - 1) * parsedLimit;
    const isCentral = isSuperAdmin(req.user) || isGlobalAuditor(req.user);

    const buildConditions = () => {
      const conditions = [];
      const params     = [];
      buildDateWhere(conditions, params, from, to);
      if (visitor_type)  { conditions.push('vr.visit_category = ?'); params.push(visitor_type); }
      if (department_id) { conditions.push('vr.department_id = ?');  params.push(department_id); }
      if (search) {
        conditions.push('(vr.visitor_name LIKE ? OR d.name LIKE ? OR vr.purpose LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      return { conditions, params };
    };

    const SELECT = `
      SELECT
        vr.id, vr.visitor_name, vr.visitor_phone,
        vr.visit_date, vr.visit_start_time,
        vr.visit_category, vr.purpose, vr.status,
        d.name AS department_name,
        h.full_name AS host_name,
        vr.created_at
      FROM visit_requests vr
      LEFT JOIN departments d ON d.id = vr.department_id
      LEFT JOIN users h ON h.id = vr.host_user_id`;

    if (isCentral) {
      const { queryAllUnits } = require('../services/dbManager');
      const { conditions, params } = buildConditions();
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      if (unit_db) {
        const { pool, unitName } = await getScopedUnit(unit_db);
        const [[{ total }]] = await pool.query(
          `SELECT COUNT(*) AS total FROM visit_requests vr LEFT JOIN departments d ON d.id = vr.department_id LEFT JOIN users h ON h.id = vr.host_user_id ${where}`, params
        );
        const [rows] = await pool.query(`${SELECT} ${where} ORDER BY vr.visit_date DESC LIMIT ? OFFSET ?`, [...params, parsedLimit, parsedOffset]);
        return sendSuccess(res, { rows: rows.map(r => ({ ...r, unit_name: unitName })), total: Number(total), page: parseInt(page), limit: parsedLimit });
      }
      const fanned = await queryAllUnits(`${SELECT} ${where} ORDER BY vr.visit_date DESC`, params);
      let rows = [];
      for (const r of fanned) rows = rows.concat(r.rows.map(row => ({ ...row, unit_name: r.unit_name })));
      rows.sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date));
      return sendSuccess(res, { rows: rows.slice(parsedOffset, parsedOffset + parsedLimit), total: rows.length, page: parseInt(page), limit: parsedLimit });
    }

    const { conditions, params } = buildConditions();
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [[{ total }]] = await req.db.query(
      `SELECT COUNT(*) AS total FROM visit_requests vr LEFT JOIN departments d ON d.id = vr.department_id LEFT JOIN users h ON h.id = vr.host_user_id ${where}`, params
    );
    const [rows] = await req.db.query(`${SELECT} ${where} ORDER BY vr.visit_date DESC LIMIT ? OFFSET ?`, [...params, parsedLimit, parsedOffset]);
    return sendSuccess(res, { rows, total: Number(total), page: parseInt(page), limit: parsedLimit });
  } catch (err) {
    console.error('[ReportController] getDepartmentWiseReport error:', err.message);
    return sendError(res, 'Failed to fetch department-wise report.', 500);
  }
};

// â”€â”€ GET /api/reports/unit-wise â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const getUnitWiseReport = async (req, res) => {
  try {
    const { from, to, visitor_type, unit_db } = req.query;
    const isCentral = isSuperAdmin(req.user) || isGlobalAuditor(req.user);

    const buildConds = () => {
      const conditions = []; const params = [];
      buildDateWhere(conditions, params, from, to);
      if (visitor_type) { conditions.push('visit_category = ?'); params.push(visitor_type); }
      return { conditions, params };
    };
    const buildCondsAliased = () => {
      const conditions = []; const params = [];
      buildDateWhere(conditions, params, from, to);
      if (visitor_type) { conditions.push('vr.visit_category = ?'); params.push(visitor_type); }
      return { conditions, params };
    };

    if (isCentral) {
      const { queryAllUnits, centralPool } = require('../services/dbManager');
      const [allUnits] = await centralPool.query(`SELECT id, name, db_name, db_status FROM units WHERE is_active = 1`);

      if (unit_db) {
        // Single unit: per-dept breakdown
        const { pool, unitName } = await getScopedUnit(unit_db);
        const { conditions, params } = buildCondsAliased();
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const [rows] = await pool.query(
          `SELECT COALESCE(d.name, 'No Department') AS department_name, vr.visit_category, vr.status, COUNT(vr.id) AS count
           FROM visit_requests vr LEFT JOIN departments d ON d.id = vr.department_id
           ${where} GROUP BY d.id, vr.visit_category, vr.status ORDER BY department_name ASC`,
          params
        );
        return sendSuccess(res, {
          rows: [{ unit_name: unitName, unit_db, breakdown: rows, total: rows.reduce((s, r) => s + Number(r.count), 0) }],
          units: allUnits.map(u => ({ id: u.id, name: u.name, db_name: u.db_name, status: u.db_status })),
        });
      }

      // Fan-out: one card per unit
      const { conditions, params } = buildConds();
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const fanned = await queryAllUnits(
        `SELECT visit_category, status, COUNT(*) AS count FROM visit_requests ${where} GROUP BY visit_category, status`, params
      );
      const rows = fanned.map(r => ({
        unit_name: r.unit_name, unit_db: r.unit_db,
        breakdown: r.rows,
        total: r.rows.reduce((s, row) => s + Number(row.count), 0),
      })).sort((a, b) => b.total - a.total);
      return sendSuccess(res, { rows, units: allUnits.map(u => ({ id: u.id, name: u.name, db_name: u.db_name, status: u.db_status })) });
    }

    // Unit-level: dept breakdown (no unit filter)
    const { conditions, params } = buildCondsAliased();
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await req.db.query(
      `SELECT
         COALESCE(d.name, 'No Department') AS department_name,
         COALESCE(vr.visit_category, 'UNKNOWN') AS visit_category,
         vr.status, COUNT(vr.id) AS count
       FROM visit_requests vr LEFT JOIN departments d ON d.id = vr.department_id
       ${where} GROUP BY d.id, vr.visit_category, vr.status ORDER BY department_name ASC`,
      params
    );
    return sendSuccess(res, { rows });
  } catch (err) {
    console.error('[ReportController] getUnitWiseReport error:', err.message);
    return sendError(res, 'Failed to fetch unit-wise report.', 500);
  }
};

// â”€â”€ GET /api/reports/rejected â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const getRejectedReport = async (req, res) => {
  try {
    const { from, to, visitor_type, department_id, unit_db, search, page = 1, limit = 50 } = req.query;
    const parsedLimit  = Math.min(200, parseInt(limit, 10) || 50);
    const parsedOffset = (Math.max(1, parseInt(page, 10)) - 1) * parsedLimit;
    const isCentral = isSuperAdmin(req.user) || isGlobalAuditor(req.user);

    const buildConditions = () => {
      const conditions = ["vr.status IN ('REJECTED','CANCELLED')"];
      const params     = [];
      buildDateWhere(conditions, params, from, to);
      if (visitor_type)  { conditions.push('vr.visit_category = ?'); params.push(visitor_type); }
      if (department_id) { conditions.push('vr.department_id = ?');  params.push(department_id); }
      if (search) {
        conditions.push('(vr.visitor_name LIKE ? OR vr.visitor_phone LIKE ? OR vr.purpose LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      return { conditions, params };
    };

    const SELECT = `
      SELECT
        vr.id, vr.visitor_name, vr.visitor_phone, vr.visitor_email,
        vr.visit_date, vr.visit_category, vr.purpose, vr.status,
        d.name AS department_name,
        h.full_name AS host_name,
        vr.created_at
      FROM visit_requests vr
      LEFT JOIN departments d ON d.id = vr.department_id
      LEFT JOIN users h ON h.id = vr.host_user_id`;

    if (isCentral) {
      const { queryAllUnits } = require('../services/dbManager');
      const { conditions, params } = buildConditions();
      const where = `WHERE ${conditions.join(' AND ')}`;

      if (unit_db) {
        const { pool, unitName } = await getScopedUnit(unit_db);
        const [[{ total }]] = await pool.query(
          `SELECT COUNT(*) AS total FROM visit_requests vr LEFT JOIN departments d ON d.id = vr.department_id LEFT JOIN users h ON h.id = vr.host_user_id ${where}`, params
        );
        const [rows] = await pool.query(`${SELECT} ${where} ORDER BY vr.visit_date DESC LIMIT ? OFFSET ?`, [...params, parsedLimit, parsedOffset]);
        return sendSuccess(res, { rows: rows.map(r => ({ ...r, unit_name: unitName })), total: Number(total), page: parseInt(page), limit: parsedLimit });
      }
      const fanned = await queryAllUnits(`${SELECT} ${where} ORDER BY vr.visit_date DESC`, params);
      let rows = [];
      for (const r of fanned) rows = rows.concat(r.rows.map(row => ({ ...row, unit_name: r.unit_name })));
      rows.sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date));
      return sendSuccess(res, { rows: rows.slice(parsedOffset, parsedOffset + parsedLimit), total: rows.length, page: parseInt(page), limit: parsedLimit });
    }

    const { conditions, params } = buildConditions();
    const where = `WHERE ${conditions.join(' AND ')}`;
    const [[{ total }]] = await req.db.query(
      `SELECT COUNT(*) AS total FROM visit_requests vr LEFT JOIN departments d ON d.id = vr.department_id LEFT JOIN users h ON h.id = vr.host_user_id ${where}`, params
    );
    const [rows] = await req.db.query(`${SELECT} ${where} ORDER BY vr.visit_date DESC LIMIT ? OFFSET ?`, [...params, parsedLimit, parsedOffset]);
    return sendSuccess(res, { rows, total: Number(total), page: parseInt(page), limit: parsedLimit });
  } catch (err) {
    console.error('[ReportController] getRejectedReport error:', err.message);
    return sendError(res, 'Failed to fetch rejected report.', 500);
  }
};

// â”€â”€ GET /api/reports/active-expected â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const getActiveExpectedReport = async (req, res) => {
  try {
    const { date, visitor_type, unit_db, department_id, search } = req.query;
    const targetDate = date || getISTDateString();
    const isCentral  = isSuperAdmin(req.user) || isGlobalAuditor(req.user);

    const mkExpected = () => {
      const c = [`vr.visit_date = ? AND vr.status = 'APPROVED' AND vr.id NOT IN (SELECT visit_request_id FROM visit_logs)`]; const p = [targetDate];
      if (visitor_type)  { c.push('vr.visit_category = ?'); p.push(visitor_type); }
      if (department_id) { c.push('vr.department_id = ?');  p.push(department_id); }
      if (search) { c.push('(vr.visitor_name LIKE ? OR vr.visitor_phone LIKE ?)'); p.push(`%${search}%`, `%${search}%`); }
      return { c, p };
    };

    const ESEL = `
      SELECT vr.id, vr.visitor_name, vr.visitor_phone, vr.visit_date,
             vr.visit_start_time AS check_in_time, vr.visit_category, vr.purpose,
             NULL AS gate_name, d.name AS department_name, h.full_name AS host_name, 'EXPECTED' AS report_status
      FROM visit_requests vr
      LEFT JOIN departments d ON d.id = vr.department_id
      LEFT JOIN users h ON h.id = vr.host_user_id`;

    if (isCentral) {
      const { queryAllUnits } = require('../services/dbManager');
      const { c: eC, p: eP } = mkExpected();

      if (unit_db) {
        const { pool, unitName } = await getScopedUnit(unit_db);
        const [expected] = await pool.query(`${ESEL} WHERE ${eC.join(' AND ')} ORDER BY vr.visit_start_time ASC`, eP);
        return sendSuccess(res, {
          active:   [],
          expected: expected.map(r => ({ ...r, unit_name: unitName })),
          date: targetDate,
        });
      }
      const fanE = await queryAllUnits(`${ESEL} WHERE ${eC.join(' AND ')} ORDER BY vr.visit_start_time ASC`, eP);
      let expected = []; for (const r of fanE) expected = expected.concat(r.rows.map(row => ({ ...row, unit_name: r.unit_name })));
      return sendSuccess(res, { active: [], expected, date: targetDate });
    }

    const { c: eC, p: eP } = mkExpected();
    const [expected] = await req.db.query(`${ESEL} WHERE ${eC.join(' AND ')} ORDER BY vr.visit_start_time ASC`, eP);
    return sendSuccess(res, { active: [], expected, date: targetDate });
  } catch (err) {
    console.error('[ReportController] getActiveExpectedReport error:', err.message);
    return sendError(res, 'Failed to fetch active/expected report.', 500);
  }
};

// â”€â”€ GET /api/reports/visit-history â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const getDetailedVisitHistory = async (req, res) => {
  try {
    const { from, to, visitor_type, status, department_id, unit_db, search, page = 1, limit = 50 } = req.query;
    const parsedLimit  = Math.min(200, parseInt(limit, 10) || 50);
    const parsedOffset = (Math.max(1, parseInt(page, 10)) - 1) * parsedLimit;
    const isCentral = isSuperAdmin(req.user) || isGlobalAuditor(req.user);

    const buildConditions = () => {
      const conditions = ["vr.status = 'COMPLETED'"]; const params = [];
      buildDateWhere(conditions, params, from, to);
      if (visitor_type)  { conditions.push('vr.visit_category = ?'); params.push(visitor_type); }
      if (department_id) { conditions.push('vr.department_id = ?');   params.push(department_id); }
      if (search) {
        conditions.push('(vr.visitor_name LIKE ? OR vr.visitor_phone LIKE ? OR h.full_name LIKE ? OR vr.purpose LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
      }
      return { conditions, params };
    };

    const SELECT = `
      SELECT
        vr.id, vr.visitor_name, vr.visitor_phone, vr.visitor_email,
        vr.visit_date, vr.visit_start_time, vr.visit_end_time,
        vr.visit_category, vr.purpose, vr.status,
        d.name AS department_name,
        h.full_name AS host_name, h.employee_code,
        vl.check_in_at AS check_in_time, vl.check_out_at AS check_out_time, NULL AS gate_name,
        vr.created_at
      FROM visit_requests vr
      LEFT JOIN departments d ON d.id = vr.department_id
      LEFT JOIN users h ON h.id = vr.host_user_id
      LEFT JOIN visit_logs vl ON vl.visit_request_id = vr.id AND vl.status = 'ACTIVE'`;

    if (isCentral) {
      const { queryAllUnits } = require('../services/dbManager');
      const { conditions, params } = buildConditions();
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      if (unit_db) {
        const { pool, unitName } = await getScopedUnit(unit_db);
        const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM visit_requests vr LEFT JOIN departments d ON d.id = vr.department_id LEFT JOIN users h ON h.id = vr.host_user_id LEFT JOIN visit_logs vl ON vl.visit_request_id = vr.id AND vl.status = 'ACTIVE' ${where}`, params
        );
        const [rows] = await pool.query(`${SELECT} ${where} ORDER BY vr.visit_date DESC LIMIT ? OFFSET ?`, [...params, parsedLimit, parsedOffset]);
        return sendSuccess(res, { rows: rows.map(r => ({ ...r, unit_name: unitName })), total: Number(total), page: parseInt(page), limit: parsedLimit });
      }
      const fanned = await queryAllUnits(`${SELECT} ${where} ORDER BY vr.visit_date DESC`, params);
      let rows = [];
      for (const r of fanned) rows = rows.concat(r.rows.map(row => ({ ...row, unit_name: r.unit_name })));
      rows.sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date));
      return sendSuccess(res, { rows: rows.slice(parsedOffset, parsedOffset + parsedLimit), total: rows.length, page: parseInt(page), limit: parsedLimit });
    }

    const { conditions, params } = buildConditions();
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [[{ total }]] = await req.db.query(
      `SELECT COUNT(*) AS total FROM visit_requests vr LEFT JOIN departments d ON d.id = vr.department_id LEFT JOIN users h ON h.id = vr.host_user_id LEFT JOIN visit_logs vl ON vl.visit_request_id = vr.id AND vl.status = 'ACTIVE' ${where}`, params
    );
    const [rows] = await req.db.query(`${SELECT} ${where} ORDER BY vr.visit_date DESC LIMIT ? OFFSET ?`, [...params, parsedLimit, parsedOffset]);
    return sendSuccess(res, { rows, total: Number(total), page: parseInt(page), limit: parsedLimit });
  } catch (err) {
    console.error('[ReportController] getDetailedVisitHistory error:', err.message);
    return sendError(res, 'Failed to fetch visit history.', 500);
  }
};

module.exports = {
  getVisitorSummary, getByStatus, getByDepartment,
  getByVisitorType, getDailyTraffic, getTopHosts,
  getUnitAuditLogs, getGlobalAuditLogs,
  getGlobalSummary, getGlobalRecentVisits,
  // Cascading filter meta endpoints
  getMetaUnits, getMetaDepartments, getMetaEmployees,
  // Tabbed data report endpoints
  getEmployeeWiseReport, getDepartmentWiseReport, getUnitWiseReport,
  getRejectedReport, getActiveExpectedReport, getDetailedVisitHistory,
};

