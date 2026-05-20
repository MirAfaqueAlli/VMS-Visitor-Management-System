// backend/controllers/gatePass.controller.js
'use strict';

const db                  = require('../db');
const { sendSuccess, sendError } = require('../utils/response.util');
const { logAudit }        = require('../utils/auditLogger.util');
const { generatePassNumber } = require('../utils/passNumber.util');
const { generateQRCode }  = require('../services/qrcode.service');

// ── Helper: build a full gate-pass row with joined details ───────────────────
async function fetchFullPass(passId) {
  const [rows] = await db.query(
    `SELECT gp.*,
            vr.visit_date, vr.purpose, vr.status AS request_status,
            vr.visit_start_time, vr.visit_end_time, vr.accompanying_count,
            COALESCE(v.full_name, ru.full_name) AS visitor_name,
            COALESCE(v.email, ru.email)         AS visitor_email,
            COALESCE(v.phone, ru.phone)         AS visitor_phone,
            h.full_name  AS host_name,
            d.name       AS department_name,
            o.name       AS organization_name,
            o.code       AS org_code
            
     FROM gate_passes gp
     JOIN visit_requests vr ON vr.id = gp.visit_request_id
     JOIN organizations  o  ON o.id  = vr.organization_id
     JOIN departments    d  ON d.id  = vr.department_id
     
     JOIN users          h  ON h.id  = vr.host_user_id
     LEFT JOIN visitors  v  ON v.id  = vr.visitor_id
     LEFT JOIN users     ru ON ru.id = vr.requester_user_id
     WHERE gp.id = ?`,
    [passId]
  );
  return rows[0] || null;
}

// ────────────────────────────────────────────────────────────────────────────
// POST /api/passes/generate/:requestId
// ────────────────────────────────────────────────────────────────────────────
const generatePass = async (req, res) => {
  try {
    const requestId = parseInt(req.params.requestId, 10);
    if (isNaN(requestId)) return sendError(res, 'Invalid request ID.', 400);

    // ── 1. Fetch the visit request with org + visitor info ──────────────────
    const [vrRows] = await db.query(
      `SELECT vr.*,
              o.code  AS org_code,
              COALESCE(v.full_name,  ru.full_name) AS visitor_name,
              COALESCE(v.email,      ru.email)      AS visitor_email
       FROM visit_requests vr
       JOIN organizations o  ON o.id  = vr.organization_id
       LEFT JOIN visitors  v  ON v.id  = vr.visitor_id
       LEFT JOIN users     ru ON ru.id = vr.requester_user_id
       WHERE vr.id = ?`,
      [requestId]
    );

    if (!vrRows.length) return sendError(res, 'Visit request not found.', 404);

    const request = vrRows[0];

    // ── 2. Status guard ─────────────────────────────────────────────────────
    if (request.status !== 'APPROVED') {
      return sendError(
        res,
        'Gate pass can only be generated for APPROVED requests.',
        400
      );
    }

    // ── 3. Idempotency — return existing pass if already generated ──────────
    const [existingRows] = await db.query(
      `SELECT id FROM gate_passes WHERE visit_request_id = ? LIMIT 1`,
      [requestId]
    );

    if (existingRows.length) {
      const existing = await fetchFullPass(existingRows[0].id);
      return sendSuccess(res, existing, 'Gate pass already exists.', 200);
    }

    // ── 4. Generate pass number & QR code ───────────────────────────────────
    const passNumber = generatePassNumber(request.org_code);

    const qrData = {
      passNumber,
      visitRequestId: requestId,
      visitDate:      request.visit_date,
      visitorName:    request.visitor_name || 'Unknown',
    };

    const qrCodePath = await generateQRCode(qrData, passNumber);

    // ── 5. Persist gate pass ────────────────────────────────────────────────
    const [insertResult] = await db.query(
      `INSERT INTO gate_passes
         (visit_request_id, pass_number, qr_code_data, qr_code_path, status, issued_by, issued_at, created_at)
       VALUES (?, ?, ?, ?, 'ISSUED', ?, NOW(), NOW())`,
      [requestId, passNumber, JSON.stringify(qrData), qrCodePath, req.user.id]
    );

    const newPassId = insertResult.insertId;

    // ── 6. Audit log ────────────────────────────────────────────────────────
    logAudit({
      userId:     req.user.id,
      action:     'GENERATE_PASS',
      module:     'GATE',
      recordType: 'GATE_PASS',
      recordId:   newPassId,
      ipAddress:  req.ip,
      userAgent:  req.headers['user-agent'],
    });

    const fullPass = await fetchFullPass(newPassId);
    return sendSuccess(res, fullPass, 'Gate pass generated successfully.', 201);
  } catch (err) {
    console.error('[generatePass]', err);
    return sendError(res, 'Failed to generate gate pass.', 500);
  }
};

// ────────────────────────────────────────────────────────────────────────────
// GET /api/passes/pass/:passNumber
// ────────────────────────────────────────────────────────────────────────────
const getPass = async (req, res) => {
  try {
    const { passNumber } = req.params;

    const [rows] = await db.query(
      `SELECT id FROM gate_passes WHERE pass_number = ? LIMIT 1`,
      [passNumber]
    );

    if (!rows.length) return sendError(res, 'Gate pass not found.', 404);

    const passId = rows[0].id;

    // Mark as printed (viewing = printing intent)
    await db.query(
      `UPDATE gate_passes SET is_printed = TRUE WHERE id = ?`,
      [passId]
    );

    const fullPass = await fetchFullPass(passId);
    return sendSuccess(res, fullPass, 'Gate pass retrieved successfully.');
  } catch (err) {
    console.error('[getPass]', err);
    return sendError(res, 'Failed to retrieve gate pass.', 500);
  }
};

// ────────────────────────────────────────────────────────────────────────────
// GET /api/passes/
// ────────────────────────────────────────────────────────────────────────────
const listPasses = async (req, res) => {
  try {
    const status = req.query.status || null;
    const date   = req.query.date   || null;
    const page   = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const conditions = [];
    const params     = [];

    if (status) { conditions.push('gp.status = ?');           params.push(status); }
    if (date)   { conditions.push('vr.visit_date = ?');        params.push(date);   }

    const whereClause = conditions.length
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total
       FROM gate_passes gp
       JOIN visit_requests vr ON vr.id = gp.visit_request_id
       ${whereClause}`,
      params
    );
    const total = countRows[0].total;

    const [passes] = await db.query(
      `SELECT gp.id, gp.pass_number, gp.status, gp.is_printed,
              gp.qr_code_path, gp.issued_at,
              vr.id AS visit_request_id, vr.visit_date, vr.purpose,
              vr.status AS request_status,
              COALESCE(v.full_name, ru.full_name) AS visitor_name,
              COALESCE(v.phone,     ru.phone)      AS visitor_phone,
              h.full_name  AS host_name,
              d.name       AS department_name,
              o.name       AS organization_name
              
       FROM gate_passes gp
       JOIN visit_requests vr ON vr.id = gp.visit_request_id
       JOIN organizations  o  ON o.id  = vr.organization_id
       JOIN departments    d  ON d.id  = vr.department_id
       
       JOIN users          h  ON h.id  = vr.host_user_id
       LEFT JOIN visitors  v  ON v.id  = vr.visitor_id
       LEFT JOIN users     ru ON ru.id = vr.requester_user_id
       ${whereClause}
       ORDER BY gp.issued_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return sendSuccess(res, {
      passes,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    }, 'Gate passes retrieved successfully.');
  } catch (err) {
    console.error('[listPasses]', err);
    return sendError(res, 'Failed to retrieve gate passes.', 500);
  }
};

module.exports = { generatePass, getPass, listPasses };
