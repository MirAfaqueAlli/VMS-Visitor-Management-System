// backend/controllers/gate.controller.js
'use strict';

const db = require('../db');
const { sendSuccess, sendError } = require('../utils/response.util');
const { logAudit } = require('../utils/auditLogger.util');
const { isOrgAdmin } = require('../middlewares/rbac.middleware');

// ────────────────────────────────────────────────────────────────────────────
// GET /api/gate/dashboard
// ────────────────────────────────────────────────────────────────────────────
const getDashboard = async (req, res) => {
  try {
    const isEmployee = req.user.role_type === 'employee';
    const hostFilter = isEmployee ? ` AND vr.host_user_id = ${parseInt(req.user.id, 10)} ` : '';
    // Department scope: org_admin sees all; others see only their department
    const deptFilter = isOrgAdmin(req.user) ? '' : ` AND vr.department_id = ${parseInt(req.user.department_id, 10)} `;

    const [
      [yetToCome],
      [active],
      [completedToday],
      [pendingApproval],
    ] = await Promise.all([

      // Query 1 — Yet-to-Come: APPROVED visits for today with ISSUED gate pass
      db.query(
        `SELECT vr.id, vr.purpose, vr.visit_date, vr.visit_start_time, vr.accompanying_count,
                 vr.visit_category AS visitor_type_code,
                h.full_name  AS host_name,
                d.name       AS department_name,
                CASE WHEN vr.visit_category = 'VENDOR' THEN COALESCE(vr.company_name, 'Unknown Vendor') ELSE COALESCE(v.full_name, ru.full_name) END AS visitor_name,
                COALESCE(v.phone,      ru.phone)      AS visitor_phone,
                gp.pass_number, gp.id AS gate_pass_id
         FROM visit_requests vr
         
         JOIN users          h  ON h.id  = vr.host_user_id
         JOIN departments    d  ON d.id  = vr.department_id
         LEFT JOIN visitors  v  ON v.id  = vr.visitor_id
         LEFT JOIN users     ru ON ru.id = vr.requester_user_id
         LEFT JOIN gate_passes gp ON gp.visit_request_id = vr.id
         WHERE vr.visit_date = CURDATE() AND vr.status = 'APPROVED'
           ${hostFilter}
           ${deptFilter}
           AND (gp.status IS NULL OR gp.status = 'ISSUED')
         ORDER BY vr.visit_start_time ASC`
      ),

      // Query 2 — Active (Currently Inside)
      db.query(
        `SELECT vl.id AS visit_log_id, vl.check_in_at, vl.visitor_photo_path,
                vl.id_verified_type, vl.id_verified_number,
                vr.id AS visit_request_id, vr.purpose,
                
                h.full_name  AS host_name,
                d.name       AS department_name,
                CASE WHEN vr.visit_category = 'VENDOR' THEN COALESCE(vr.company_name, 'Unknown Vendor') ELSE COALESCE(v.full_name, ru.full_name) END AS visitor_name,
                COALESCE(v.phone,      ru.phone)      AS visitor_phone,
                gp.pass_number
         FROM visit_logs vl
         JOIN gate_passes     gp ON gp.id = vl.gate_pass_id
         JOIN visit_requests vr ON vr.id = gp.visit_request_id
         
         JOIN users           h  ON h.id  = vr.host_user_id
         JOIN departments     d  ON d.id  = vr.department_id
         LEFT JOIN visitors   v  ON v.id  = vr.visitor_id
         LEFT JOIN users      ru ON ru.id = vr.requester_user_id
         WHERE vl.status = 'ACTIVE'
           ${hostFilter}
           ${deptFilter}
         ORDER BY vl.check_in_at DESC`
      ),

      // Query 3 — Completed Today
      db.query(
        `SELECT vl.id AS visit_log_id, vl.check_in_at, vl.check_out_at,
                vr.purpose, 
                CASE WHEN vr.visit_category = 'VENDOR' THEN COALESCE(vr.company_name, 'Unknown Vendor') ELSE COALESCE(v.full_name, ru.full_name) END AS visitor_name,
                h.full_name  AS host_name,
                d.name       AS department_name,
                gp.pass_number
         FROM visit_logs vl
         JOIN gate_passes     gp ON gp.id = vl.gate_pass_id
         JOIN visit_requests vr ON vr.id = gp.visit_request_id
         
         JOIN users           h  ON h.id  = vr.host_user_id
         JOIN departments     d  ON d.id  = vr.department_id
         LEFT JOIN visitors   v  ON v.id  = vr.visitor_id
         LEFT JOIN users      ru ON ru.id = vr.requester_user_id
         WHERE vl.status = 'COMPLETED' AND DATE(vl.check_out_at) = CURDATE()
           ${hostFilter}
           ${deptFilter}
         ORDER BY vl.check_out_at DESC`
      ),

      // Query 4 — Pending Approvals for Today
      db.query(
        `SELECT vr.id, vr.purpose, vr.visit_date, 
                CASE WHEN vr.visit_category = 'VENDOR' THEN COALESCE(vr.company_name, 'Unknown Vendor') ELSE COALESCE(v.full_name, ru.full_name) END AS visitor_name,
                h.full_name AS host_name
         FROM visit_requests vr
         
         JOIN users          h  ON h.id  = vr.host_user_id
         LEFT JOIN visitors  v  ON v.id  = vr.visitor_id
         LEFT JOIN users     ru ON ru.id = vr.requester_user_id
         WHERE vr.visit_date = CURDATE() AND vr.status = 'PENDING'
           ${hostFilter}
           ${deptFilter}
         ORDER BY vr.created_at ASC`
      ),
    ]);

    return sendSuccess(res, {
      yet_to_come:      yetToCome,
      active:           active,
      completed_today:  completedToday,
      pending_approval: pendingApproval,
      summary: {
        yet_to_come_count:    yetToCome.length,
        active_count:         active.length,
        completed_today_count: completedToday.length,
        pending_count:        pendingApproval.length,
      },
    }, 'Dashboard data retrieved successfully.');
  } catch (err) {
    console.error('[getDashboard]', err);
    return sendError(res, 'Failed to retrieve dashboard data.', 500);
  }
};

// ────────────────────────────────────────────────────────────────────────────
// POST /api/gate/checkin/:requestId
// ────────────────────────────────────────────────────────────────────────────
const checkIn = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const requestId      = parseInt(req.params.requestId, 10);
    if (isNaN(requestId)) return sendError(res, 'Invalid request ID.', 400);

    const { id_verified_type, id_verified_number, remarks, pass_number } = req.body;
    const visitorPhotoPath = req.file ? req.file.path.replace(/\\/g, '/') : null;

    // ── 1. Validate required fields ─────────────────────────────────────────
    if (!id_verified_type || !id_verified_number) {
      return sendError(res, 'id_verified_type and id_verified_number are required.', 400);
    }
    if (!pass_number) {
      return sendError(res, 'Gate Pass number is required for verification.', 400);
    }

    // ── 2. Fetch visit request + gate pass ──────────────────────────────────
    const [vrRows] = await db.query(
      `SELECT vr.*, gp.id AS gate_pass_id, gp.pass_number, gp.status AS pass_status,
              v.id AS visitor_id_val
       FROM visit_requests vr
       LEFT JOIN gate_passes gp ON gp.visit_request_id = vr.id
       LEFT JOIN visitors    v  ON v.id  = vr.visitor_id
       WHERE vr.id = ?`,
      [requestId]
    );

    if (!vrRows.length) return sendError(res, 'Visit request not found.', 404);

    const request = vrRows[0];

    if (!request.gate_pass_id) {
      return sendError(res, 'Gate pass not generated yet. Generate a pass first.', 400);
    }

    if (request.pass_status !== 'ISSUED') {
      return sendError(res, 'Gate pass has already been used or cancelled.', 400);
    }

    if (request.pass_number !== pass_number) {
      return sendError(res, 'Gate pass number mismatch. Verification failed.', 403);
    }

    // Department isolation: non-org-admin security must only check in visitors for their dept
    if (!isOrgAdmin(req.user) && request.department_id !== req.user.department_id) {
      return sendError(res, 'Access denied. This visit request belongs to a different department.', 403);
    }

    // ── Enforce strict ID matching for registered visitors ──────────────────
    if (request.visitor_id_val) {
      const [idProofRows] = await db.query(
        `SELECT id_number FROM visitor_documents WHERE visitor_id = ? AND id_type = ? LIMIT 1`,
        [request.visitor_id_val, id_verified_type]
      );
      
      if (idProofRows.length > 0) {
        if (idProofRows[0].id_number !== id_verified_number) {
          return sendError(res, `ID Mismatch: The provided ${id_verified_type} does not match the registered ${id_verified_type} for this visitor.`, 400);
        }
      }
    }

    // ── 3. Blacklist check ──────────────────────────────────────────────────
    if (request.visitor_id_val) {
      const [blacklistRows] = await db.query(
        `SELECT id, reason FROM blacklisted_visitors
         WHERE visitor_id = ? AND is_active = TRUE LIMIT 1`,
        [request.visitor_id_val]
      );

      if (blacklistRows.length) {
        const reason = blacklistRows[0].reason;

        // Record the scan log rejection
        await db.query(
          `INSERT INTO qr_scan_logs
             (organization_id, gate_pass_id, scanned_by_user_id, qr_data, result, failure_reason, device_id, ip_address, scanned_at)
           VALUES (?, ?, ?, ?, 'blacklisted', ?, ?, ?, NOW())`,
          [
            request.organization_id,
            request.gate_pass_id || null,
            req.user.id,
            request.pass_number || requestId.toString(),
            `Visitor is blacklisted: ${reason}`,
            (req.headers['user-agent'] || '').substring(0, 100) || null,
            req.ip
          ]
        );

        logAudit({
          userId:     req.user.id,
          action:     'GATE_REJECT',
          module:     'GATE',
          recordType: 'VISIT_REQUEST',
          recordId:   requestId,
          ipAddress:  req.ip,
          userAgent:  req.headers['user-agent'],
        });

        return sendError(res, `Entry denied. Visitor is blacklisted: ${reason}`, 403);
      }
    }

    // ── 4. Transaction: insert visit_log + update gate pass ─────────────────
    await conn.beginTransaction();

    const [logInsert] = await conn.query(
      `INSERT INTO visit_logs
         (gate_pass_id, checked_in_by,
          visitor_photo_path, id_verified_type, id_verified_number,
          check_in_at, status, remarks, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(), 'ACTIVE', ?, NOW(), NOW())`,
      [
        request.gate_pass_id,
        req.user.id,
        visitorPhotoPath,
        id_verified_type,
        id_verified_number,
        remarks || null,
      ]
    );

    await conn.query(
      `UPDATE gate_passes SET status = 'USED' WHERE id = ?`,
      [request.gate_pass_id]
    );
    await conn.commit();

    await db.query(
      `INSERT INTO qr_scan_logs
         (organization_id, gate_pass_id, scanned_by_user_id, qr_data, result, device_id, ip_address, scanned_at)
       VALUES (?, ?, ?, ?, 'valid', ?, ?, NOW())`,
      [
        request.organization_id,
        request.gate_pass_id,
        req.user.id,
        request.pass_number || requestId.toString(),
        (req.headers['user-agent'] || '').substring(0, 100) || null,
        req.ip
      ]
    );
    // ── 5. Audit log ────────────────────────────────────────────────────────
    logAudit({
      userId:     req.user.id,
      action:     'CHECK_IN',
      module:     'GATE',
      recordType: 'VISIT_REQUEST',
      recordId:   requestId,
      ipAddress:  req.ip,
      userAgent:  req.headers['user-agent'],
    });

    // ── 6. Return the created visit log ─────────────────────────────────────
    const [logRows] = await db.query(
      `SELECT * FROM visit_logs WHERE id = ?`,
      [logInsert.insertId]
    );

    return sendSuccess(res, logRows[0], 'Visitor checked in successfully.');
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[checkIn]', err);
    return sendError(res, 'Check-in failed due to a server error.', 500);
  } finally {
    conn.release();
  }
};

// ────────────────────────────────────────────────────────────────────────────
// POST /api/gate/checkout
// ────────────────────────────────────────────────────────────────────────────
const checkOut = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { visit_log_id, pass_number } = req.body;

    if (!visit_log_id && !pass_number) {
      return sendError(res, 'Provide either visit_log_id or pass_number.', 400);
    }

    // ── 1. Find the active visit log ────────────────────────────────────────
    let logRows;
    if (visit_log_id) {
      [logRows] = await db.query(
        `SELECT * FROM visit_logs WHERE id = ? AND status = 'ACTIVE'`,
        [visit_log_id]
      );
    } else {
      [logRows] = await db.query(
        `SELECT vl.* FROM visit_logs vl
         JOIN gate_passes gp ON gp.id = vl.gate_pass_id
         WHERE gp.pass_number = ? AND vl.status = 'ACTIVE'`,
        [pass_number]
      );
    }

    if (!logRows || !logRows.length) {
      return sendError(res, 'No active visit found for checkout.', 404);
    }

    const visitLog = logRows[0];
    const checkOutTime = new Date();
    const checkInTime  = new Date(visitLog.check_in_at);
    
    // To update the visit_request, we need the request id which is in gate_passes
    const [gpRows] = await db.query(`SELECT visit_request_id FROM gate_passes WHERE id = ?`, [visitLog.gate_pass_id]);
    const visitRequestId = gpRows[0].visit_request_id;

    // ── 2. Transaction: update log + request ────────────────────────────────
    await conn.beginTransaction();

    await conn.query(
      `UPDATE visit_logs
       SET check_out_at = NOW(), status = 'COMPLETED', checked_out_by = ?, updated_at = NOW()
       WHERE id = ?`,
      [req.user.id, visitLog.id]
    );

    await conn.query(
      `UPDATE visit_requests
       SET status = 'COMPLETED', updated_at = NOW()
       WHERE id = ?`,
      [visitRequestId]
    );

    await conn.commit();

    // ── 3. Audit log ────────────────────────────────────────────────────────
    logAudit({
      userId:     req.user.id,
      action:     'CHECK_OUT',
      module:     'GATE',
      recordType: 'VISIT_LOG',
      recordId:   visitLog.id,
      ipAddress:  req.ip,
      userAgent:  req.headers['user-agent'],
    });

    const durationMinutes = Math.round((checkOutTime - checkInTime) / 60000);

    return sendSuccess(res, {
      visit_log_id:      visitLog.id,
      visit_request_id:  visitRequestId,
      check_in_at:       visitLog.check_in_at,
      check_out_at:      checkOutTime,
      duration_minutes:  durationMinutes,
      checked_out_by:    req.user.id,
    }, 'Visitor checked out successfully.');
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[checkOut]', err);
    return sendError(res, 'Check-out failed due to a server error.', 500);
  } finally {
    conn.release();
  }
};

// ────────────────────────────────────────────────────────────────────────────
// POST /api/gate/reject
// ────────────────────────────────────────────────────────────────────────────
const rejectAtGate = async (req, res) => {
  try {
    const { visit_request_id, visitor_id, rejection_reason, qr_data } = req.body;

    if (!rejection_reason || !rejection_reason.trim()) {
      return sendError(res, 'rejection_reason is required.', 400);
    }

    if (!visit_request_id && !visitor_id && !qr_data) {
      return sendError(res, 'Provide visit_request_id, visitor_id, or qr_data.', 400);
    }

    let orgId = req.user.organization_id || 1; // Fallback
    if (visit_request_id) {
      const [vrRows] = await db.query(`SELECT organization_id FROM visit_requests WHERE id = ?`, [visit_request_id]);
      if (vrRows.length > 0) {
        orgId = vrRows[0].organization_id;
      }
    }

    // Insert qr scan log record instead of gate rejection
    const [insertResult] = await db.query(
      `INSERT INTO qr_scan_logs
         (organization_id, gate_pass_id, scanned_by_user_id, qr_data, result, failure_reason, device_id, ip_address, scanned_at)
       VALUES (?, ?, ?, ?, 'invalid', ?, ?, ?, NOW())`,
      [
        orgId,
        null,  // no gate_pass_id for unknown walk-up rejections
        req.user.id,
        qr_data || visit_request_id?.toString() || visitor_id?.toString() || 'Unknown',
        rejection_reason.trim(),
        (req.headers['user-agent'] || '').substring(0, 100) || null,
        req.ip
      ]
    );

    // If a visit request was given, mark it REJECTED
    if (visit_request_id) {
      await db.query(
        `UPDATE visit_requests SET status = 'REJECTED', updated_at = NOW() WHERE id = ?`,
        [visit_request_id]
      );
    }

    logAudit({
      userId:     req.user.id,
      action:     'GATE_REJECT',
      module:     'GATE',
      recordType: 'VISIT_REQUEST',
      recordId:   visit_request_id || null,
      ipAddress:  req.ip,
      userAgent:  req.headers['user-agent'],
    });

    return sendSuccess(res, { scan_log_id: insertResult.insertId }, 'Gate rejection recorded.', 201);
  } catch (err) {
    console.error('[rejectAtGate]', err);
    return sendError(res, 'Failed to record gate rejection.', 500);
  }
};

// ────────────────────────────────────────────────────────────────────────────
// GET /api/gate/active
// ────────────────────────────────────────────────────────────────────────────
const getActiveVisitors = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT vl.id AS visit_log_id, vl.check_in_at, vl.visitor_photo_path,
              vl.id_verified_type, vl.id_verified_number,
              vr.id AS visit_request_id, vr.purpose,
              
              h.full_name  AS host_name,
              d.name       AS department_name,
              CASE WHEN vr.visit_category = 'VENDOR' THEN COALESCE(vr.company_name, 'Unknown Vendor') ELSE COALESCE(v.full_name, ru.full_name) END AS visitor_name,
              COALESCE(v.phone,      ru.phone)      AS visitor_phone,
              gp.pass_number
       FROM visit_logs vl
       JOIN gate_passes     gp ON gp.id = vl.gate_pass_id
       JOIN visit_requests vr ON vr.id = gp.visit_request_id
       
       JOIN users           h  ON h.id  = vr.host_user_id
       JOIN departments     d  ON d.id  = vr.department_id
       LEFT JOIN visitors   v  ON v.id  = vr.visitor_id
       LEFT JOIN users      ru ON ru.id = vr.requester_user_id
       WHERE vl.status = 'ACTIVE'
       ORDER BY vl.check_in_at DESC`
    );

    return sendSuccess(res, rows, 'Active visitors retrieved successfully.');
  } catch (err) {
    console.error('[getActiveVisitors]', err);
    return sendError(res, 'Failed to retrieve active visitors.', 500);
  }
};

module.exports = { getDashboard, checkIn, checkOut, rejectAtGate, getActiveVisitors };
