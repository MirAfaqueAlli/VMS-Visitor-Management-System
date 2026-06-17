// backend/controllers/gatePass.controller.js
'use strict';

const { sendSuccess, sendError } = require('../utils/response.util');
const { logAudit }               = require('../utils/auditLogger.util');
const { generateGatePass }       = require('../services/gatePass.service');
const { isSuperAdmin, isUnitAdmin } = require('../middlewares/rbac.middleware');

// ── Helper: fetch a full gate pass row with joins ─────────────────────────────
async function fetchFullPass(db, passId) {
  const [rows] = await db.query(
    `SELECT gp.*,
            vr.visit_date, vr.visit_start_time, vr.visit_end_time,
            vr.purpose, vr.status AS request_status, vr.visit_category,
            vr.visitor_name, vr.visitor_phone, vr.company_name,
            COALESCE(v.full_name, vr.visitor_name) AS resolved_visitor_name,
            h.full_name  AS host_name,
            d.name       AS department_name
     FROM gate_passes gp
     JOIN visit_requests vr ON vr.id = gp.visit_request_id
     JOIN users           h  ON h.id  = vr.host_user_id
     LEFT JOIN departments d  ON d.id  = vr.department_id
     LEFT JOIN visitors    v  ON v.id  = vr.visitor_id
     WHERE gp.id = ?`,
    [passId]
  );
  return rows[0] || null;
}

// ── generatePass ──────────────────────────────────────────────────────────────
/**
 * POST /api/passes/generate/:requestId
 * Manually trigger gate pass generation for an APPROVED visit request.
 * Auto-generation already happens on approve, but this is the manual fallback.
 */
const generatePass = async (req, res) => {
  try {
    const requestId = parseInt(req.params.requestId, 10);
    if (isNaN(requestId)) return sendError(res, 'Invalid request ID.', 400);

    // Confirm request exists and is APPROVED
    const [vrRows] = await req.db.query(
      `SELECT id, status, department_id FROM visit_requests WHERE id = ?`,
      [requestId]
    );
    if (!vrRows.length) return sendError(res, 'Visit request not found.', 404);

    const request = vrRows[0];

    // Department isolation — non-admin can only generate for their dept
    if (!isSuperAdmin(req.user) && !isUnitAdmin(req.user)) {
      if (req.user.department_id && request.department_id !== req.user.department_id) {
        return sendError(res, 'Access denied. This visit belongs to a different department.', 403);
      }
    }

    if (request.status !== 'APPROVED') {
      return sendError(res, 'Gate pass can only be generated for APPROVED requests.', 400);
    }

    // Delegate to service (idempotent — returns existing if already generated)
    const passResult = await generateGatePass(requestId, req.user.id, req.db);

    const fullPass = await fetchFullPass(req.db, passResult.gate_pass_id);
    return sendSuccess(res, fullPass, 'Gate pass generated successfully.', 201);
  } catch (err) {
    console.error('[GatePassController] generatePass error:', err.message);
    return sendError(res, 'Failed to generate gate pass.', 500);
  }
};

// ── getPass ───────────────────────────────────────────────────────────────────
/**
 * GET /api/passes/pass/:passNumber
 * Marks the pass as printed (viewed = print intent).
 */
const getPass = async (req, res) => {
  try {
    const { passNumber } = req.params;

    const [rows] = await req.db.query(
      `SELECT id FROM gate_passes WHERE pass_number = ? LIMIT 1`,
      [passNumber]
    );
    if (!rows.length) return sendError(res, 'Gate pass not found.', 404);

    const passId = rows[0].id;

    await req.db.query(
      `UPDATE gate_passes SET is_printed = TRUE WHERE id = ?`,
      [passId]
    );

    const fullPass = await fetchFullPass(req.db, passId);
    return sendSuccess(res, fullPass, 'Gate pass retrieved successfully.');
  } catch (err) {
    console.error('[GatePassController] getPass error:', err.message);
    return sendError(res, 'Failed to retrieve gate pass.', 500);
  }
};

// ── listPasses ────────────────────────────────────────────────────────────────
/**
 * GET /api/passes?status=ISSUED&date=YYYY-MM-DD&page=1&limit=20
 */
const listPasses = async (req, res) => {
  try {
    const { status, date } = req.query;
    const page   = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const conditions = [];
    const params     = [];

    if (status) { conditions.push('gp.status = ?');    params.push(status); }
    if (date)   { conditions.push('vr.visit_date = ?'); params.push(date);   }

    // Dept scope for non-admin roles
    if (!isSuperAdmin(req.user) && !isUnitAdmin(req.user)) {
      conditions.push('vr.department_id = ?');
      params.push(req.user.department_id);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [[{ total }]] = await req.db.query(
      `SELECT COUNT(*) AS total
       FROM gate_passes gp
       JOIN visit_requests vr ON vr.id = gp.visit_request_id
       ${where}`,
      params
    );

    const [passes] = await req.db.query(
      `SELECT gp.id, gp.pass_number, gp.status, gp.is_printed, gp.qr_code_path, gp.issued_at,
              vr.id AS visit_request_id, vr.visit_date, vr.purpose, vr.status AS request_status,
              vr.visitor_name, vr.visitor_phone, vr.company_name, vr.visit_category,
              COALESCE(v.full_name, vr.visitor_name) AS resolved_visitor_name,
              h.full_name AS host_name,
              d.name      AS department_name
       FROM gate_passes gp
       JOIN visit_requests vr ON vr.id = gp.visit_request_id
       JOIN users           h  ON h.id  = vr.host_user_id
       LEFT JOIN departments d  ON d.id  = vr.department_id
       LEFT JOIN visitors    v  ON v.id  = vr.visitor_id
       ${where}
       ORDER BY gp.issued_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return sendSuccess(res, {
      passes,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    }, 'Gate passes retrieved successfully.');
  } catch (err) {
    console.error('[GatePassController] listPasses error:', err.message);
    return sendError(res, 'Failed to retrieve gate passes.', 500);
  }
};

// ── cancelPass ────────────────────────────────────────────────────────────────
/**
 * PUT /api/passes/:id/cancel — unit_admin / super_admin only
 */
const cancelPass = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await req.db.query(
      "SELECT id, status FROM gate_passes WHERE id = ?", [id]
    );
    if (!rows.length) return sendError(res, 'Gate pass not found.', 404);
    if (rows[0].status !== 'ISSUED') {
      return sendError(res, `Cannot cancel a pass with status '${rows[0].status}'.`, 400);
    }

    await req.db.query(
      "UPDATE gate_passes SET status = 'CANCELLED' WHERE id = ?", [id]
    );

    logAudit({
      db:        req.db,
      userId:    req.user.id,
      action:    'CANCEL_PASS',
      module:    'GATE',
      recordType: 'GATE_PASS',
      recordId:  parseInt(id),
      ipAddress: req.ip,
    }).catch(() => {});

    return sendSuccess(res, null, 'Gate pass cancelled.');
  } catch (err) {
    console.error('[GatePassController] cancelPass error:', err.message);
    return sendError(res, 'Failed to cancel gate pass.', 500);
  }
};

module.exports = { generatePass, getPass, listPasses, cancelPass };
