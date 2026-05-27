// backend/controllers/gate.controller.js
'use strict';

const { sendSuccess, sendError } = require('../utils/response.util');
const { logAudit }               = require('../utils/auditLogger.util');
const { isSuperAdmin, isUnitAdmin } = require('../middlewares/rbac.middleware');

// ── getDashboard ──────────────────────────────────────────────────────────────
const getDashboard = async (req, res) => {
  try {
    const isEmployee = req.user.role_type === 'employee';
    const hostFilter = isEmployee ? ` AND vr.host_user_id = ${parseInt(req.user.id, 10)} ` : '';
    const deptFilter = (isSuperAdmin(req.user) || isUnitAdmin(req.user) || ['security', 'receptionist', 'unit_auditor'].includes(req.user.role_type))
      ? ''
      : ` AND vr.department_id = ${parseInt(req.user.department_id, 10)} `;

    const [
      [yetToCome],
      [active],
      [completedToday],
      [pendingApproval],
    ] = await Promise.all([

      // Yet-to-Come: APPROVED visits for today with ISSUED gate pass
      req.db.query(
        `SELECT vr.id, vr.purpose, vr.visit_date, vr.visit_start_time, vr.accompanying_count,
                vr.visit_category,
                vr.visitor_name, vr.visitor_phone, vr.company_name,
                h.full_name  AS host_name,
                d.name       AS department_name,
                gp.pass_number, gp.id AS gate_pass_id
         FROM visit_requests vr
         JOIN users       h  ON h.id  = vr.host_user_id
         JOIN departments d  ON d.id  = vr.department_id
         LEFT JOIN gate_passes gp ON gp.visit_request_id = vr.id
         WHERE vr.visit_date = CURDATE() AND vr.status = 'APPROVED'
           ${hostFilter}
           ${deptFilter}
           AND (gp.status IS NULL OR gp.status = 'ISSUED')
         ORDER BY vr.visit_start_time ASC`
      ),

      // Active (Currently Inside)
      req.db.query(
        `SELECT vl.id AS visit_log_id, vl.check_in_at,
                vr.id AS visit_request_id, vr.purpose, vr.visit_category,
                vr.visitor_name, vr.visitor_phone, vr.company_name,
                h.full_name  AS host_name,
                d.name       AS department_name,
                v.full_name  AS visitor_full_name,
                v.phone      AS visitor_phone_verified,
                gp.pass_number
         FROM visit_logs vl
         JOIN gate_passes    gp ON gp.id = vl.gate_pass_id
         JOIN visit_requests vr ON vr.id = gp.visit_request_id
         JOIN users           h  ON h.id  = vr.host_user_id
         JOIN departments     d  ON d.id  = vr.department_id
         LEFT JOIN visitors   v  ON v.id  = vr.visitor_id
         WHERE vl.status = 'ACTIVE'
           ${hostFilter}
           ${deptFilter}
         ORDER BY vl.check_in_at DESC`
      ),

      // Completed Today
      req.db.query(
        `SELECT vl.id AS visit_log_id, vl.check_in_at, vl.check_out_at,
                vr.purpose, vr.visit_category,
                vr.visitor_name, vr.company_name,
                h.full_name  AS host_name,
                d.name       AS department_name,
                gp.pass_number
         FROM visit_logs vl
         JOIN gate_passes    gp ON gp.id = vl.gate_pass_id
         JOIN visit_requests vr ON vr.id = gp.visit_request_id
         JOIN users           h  ON h.id  = vr.host_user_id
         JOIN departments     d  ON d.id  = vr.department_id
         WHERE vl.status = 'COMPLETED' AND DATE(vl.check_out_at) = CURDATE()
           ${hostFilter}
           ${deptFilter}
         ORDER BY vl.check_out_at DESC`
      ),

      // Pending Approvals for Today
      req.db.query(
        `SELECT vr.id, vr.purpose, vr.visit_date, vr.visitor_name, vr.visitor_phone,
                h.full_name AS host_name
         FROM visit_requests vr
         JOIN users h ON h.id = vr.host_user_id
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
        yet_to_come_count:     yetToCome.length,
        active_count:          active.length,
        completed_today_count: completedToday.length,
        pending_count:         pendingApproval.length,
      },
    }, 'Dashboard data retrieved successfully.');
  } catch (err) {
    console.error('[GateController] getDashboard error:', err.message);
    return sendError(res, 'Failed to retrieve dashboard data.', 500);
  }
};

// ── checkIn ───────────────────────────────────────────────────────────────────
/**
 * POST /api/gate/checkin/:requestId
 *
 * Key behaviour (Phase 3):
 * 1. Blacklist check by phone (visitor_id may not exist yet)
 * 2. Upsert visitor record from inline visit_request fields (visitor_phone/name/email)
 * 3. Set visit_requests.visitor_id to the upserted visitor
 * 4. Create visit_log record with visit_request_id column
 * 5. Write employee_visitor_log for the host's personal dashboard
 * 6. No qr_scan_logs (table removed from schema)
 */
const checkIn = async (req, res) => {
  const conn = await req.db.getConnection();
  try {
    const requestId = parseInt(req.params.requestId, 10);
    if (isNaN(requestId)) { conn.release(); return sendError(res, 'Invalid request ID.', 400); }

    const { id_verified_type, id_verified_number, remarks, pass_number } = req.body;
    const visitorPhotoPath = req.file ? req.file.path.replace(/\\/g, '/') : null;

    if (!id_verified_type || !id_verified_number) {
      conn.release();
      return sendError(res, 'id_verified_type and id_verified_number are required.', 400);
    }
    if (!pass_number) {
      conn.release();
      return sendError(res, 'Gate pass number is required for verification.', 400);
    }

    // ── 1. Fetch visit request + gate pass ────────────────────────────────────
    const [vrRows] = await req.db.query(
      `SELECT vr.*, gp.id AS gate_pass_id, gp.pass_number, gp.status AS pass_status
       FROM visit_requests vr
       LEFT JOIN gate_passes gp ON gp.visit_request_id = vr.id
       WHERE vr.id = ?`,
      [requestId]
    );

    if (!vrRows.length) { conn.release(); return sendError(res, 'Visit request not found.', 404); }

    const request = vrRows[0];

    if (!request.gate_pass_id) {
      conn.release();
      return sendError(res, 'Gate pass not generated yet. Generate a pass first.', 400);
    }
    if (request.pass_status !== 'ISSUED') {
      conn.release();
      return sendError(res, 'Gate pass has already been used or cancelled.', 400);
    }
    if (request.pass_number !== pass_number) {
      conn.release();
      return sendError(res, 'Gate pass number mismatch. Verification failed.', 403);
    }

    // Department isolation — non-admin security/receptionist sees only their dept
    if (!isSuperAdmin(req.user) && !isUnitAdmin(req.user)) {
      if (req.user.department_id && request.department_id !== req.user.department_id) {
        conn.release();
        return sendError(res, 'Access denied. This visit belongs to a different department.', 403);
      }
    }

    // ── 2. Blacklist check by phone (primary check at check-in) ───────────────
    if (request.visitor_phone) {
      const [blRows] = await req.db.query(
        `SELECT bv.id, bv.reason FROM blacklisted_visitors bv
         JOIN visitors v ON v.id = bv.visitor_id
         WHERE v.phone = ? AND bv.is_active = TRUE LIMIT 1`,
        [request.visitor_phone]
      );
      if (blRows.length > 0) {
        conn.release();
        return sendError(res, `Entry denied. Visitor is blacklisted: ${blRows[0].reason}`, 403);
      }
    }

    // Also check by visitor_id if already linked
    if (request.visitor_id) {
      const [blById] = await req.db.query(
        `SELECT id, reason FROM blacklisted_visitors WHERE visitor_id = ? AND is_active = TRUE LIMIT 1`,
        [request.visitor_id]
      );
      if (blById.length > 0) {
        conn.release();
        return sendError(res, `Entry denied. Visitor is blacklisted: ${blById[0].reason}`, 403);
      }
    }

    // ── 3. Upsert visitor record (created only on first check-in) ─────────────
    let visitorId = request.visitor_id;
    const visitorType = request.visit_category === 'VENDOR' ? 'business' : 'individual';

    if (!visitorId && request.visitor_phone) {
      // Check if visitor already exists by phone
      const [existingVisitor] = await req.db.query(
        'SELECT id FROM visitors WHERE phone = ?', [request.visitor_phone]
      );

      if (existingVisitor.length > 0) {
        visitorId = existingVisitor[0].id;
        // Update name/email and visitor_type if request has fresher data
        await req.db.query(
          `UPDATE visitors SET
             full_name    = COALESCE(?, full_name),
             email        = COALESCE(?, email),
             visitor_type = ?,
             updated_at   = NOW()
           WHERE id = ?`,
          [request.visitor_name || null, request.visitor_email || null, visitorType, visitorId]
        );
      } else {
        // Create new visitor record
        const [insertVis] = await req.db.query(
          `INSERT INTO visitors (full_name, phone, email, visitor_type, created_at, updated_at)
           VALUES (?, ?, ?, ?, NOW(), NOW())`,
          [request.visitor_name || 'Unknown', request.visitor_phone, request.visitor_email || null, visitorType]
        );
        visitorId = insertVis.insertId;
      }
    }

    // ── 4. ID proof check — if visitor already has a registered ID of this type, verify it
    if (visitorId) {
      const [idProofRows] = await req.db.query(
        `SELECT id_number FROM visitor_documents WHERE visitor_id = ? AND id_type = ? LIMIT 1`,
        [visitorId, id_verified_type]
      );
      if (idProofRows.length > 0 && idProofRows[0].id_number !== id_verified_number) {
        conn.release();
        return sendError(res, `ID Mismatch: The provided ${id_verified_type} does not match our records for this visitor.`, 400);
      }
      // Store ID doc if not already there (INSERT IGNORE respects the unique constraint)
      await req.db.query(
        `INSERT IGNORE INTO visitor_documents (visitor_id, id_type, id_number, is_primary, created_at) VALUES (?, ?, ?, TRUE, NOW())`,
        [visitorId, id_verified_type, id_verified_number]
      );
    }

    // ── 5. Transaction: update visit_request.visitor_id + insert visit_log + update gate pass ──
    await conn.beginTransaction();

    // Link visitor to visit request if we just resolved/created one
    if (visitorId && !request.visitor_id) {
      await conn.query(
        'UPDATE visit_requests SET visitor_id = ?, updated_at = NOW() WHERE id = ?',
        [visitorId, requestId]
      );
    }

    const [logInsert] = await conn.query(
      `INSERT INTO visit_logs
         (gate_pass_id, visit_request_id, checked_in_by,
          visitor_photo_path, id_verified_type, id_verified_number,
          check_in_at, status, remarks, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), 'ACTIVE', ?, NOW(), NOW())`,
      [
        request.gate_pass_id,
        requestId,
        req.user.id,
        visitorPhotoPath,
        id_verified_type,
        id_verified_number,
        remarks || null,
      ]
    );
    const visitLogId = logInsert.insertId;

    await conn.query(
      "UPDATE gate_passes SET status = 'USED' WHERE id = ?",
      [request.gate_pass_id]
    );

    await conn.commit();
    conn.release();

    // ── 6. Write employee_visitor_log for host's personal history ─────────────
    // Done AFTER commit so a missing/broken table can't roll back the check-in.
    if (visitorId && request.host_user_id && request.department_id) {
      try {
        await req.db.query(
          `INSERT INTO employee_visitor_log
             (host_user_id, visitor_id, visit_request_id, visit_log_id, department_id, checked_in_at, created_at)
           VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
          [request.host_user_id, visitorId, requestId, visitLogId, request.department_id]
        );
      } catch (evlErr) {
        // Non-fatal: log but don't fail the check-in
        console.warn('[GateController] employee_visitor_log insert skipped:', evlErr.message);
      }
    }

    // ── 7. Audit log ──────────────────────────────────────────────────────────
    logAudit({
      db:        req.db,
      userId:    req.user.id,
      action:    'CHECK_IN',
      module:    'GATE',
      recordType: 'VISIT_REQUEST',
      recordId:  requestId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    // ── 8. Return the created visit log ───────────────────────────────────────
    const [logRows] = await req.db.query(
      `SELECT vl.*, vr.visitor_name, vr.visitor_phone, vr.purpose, vr.visit_category,
              gp.pass_number,
              v.full_name AS visitor_full_name, v.phone AS verified_phone
       FROM visit_logs vl
       JOIN gate_passes    gp ON gp.id = vl.gate_pass_id
       JOIN visit_requests vr ON vr.id = vl.visit_request_id
       LEFT JOIN visitors   v  ON v.id  = vr.visitor_id
       WHERE vl.id = ?`,
      [visitLogId]
    );

    return sendSuccess(res, logRows[0], 'Visitor checked in successfully.');
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    if (!conn._released) conn.release();
    console.error('[GateController] checkIn error:', err.message);
    return sendError(res, 'Check-in failed due to a server error.', 500);
  }
};

// ── checkOut ──────────────────────────────────────────────────────────────────
const checkOut = async (req, res) => {
  const conn = await req.db.getConnection();
  try {
    const { pass_number } = req.body;
    const visit_log_id = req.params.visitLogId || req.body.visit_log_id;

    if (!visit_log_id && !pass_number) {
      conn.release();
      return sendError(res, 'Provide either visit_log_id or pass_number.', 400);
    }

    // ── 1. Find the active visit log ──────────────────────────────────────────
    let logRows;
    if (visit_log_id) {
      [logRows] = await req.db.query(
        "SELECT * FROM visit_logs WHERE id = ? AND status = 'ACTIVE'",
        [visit_log_id]
      );
    } else {
      [logRows] = await req.db.query(
        `SELECT vl.* FROM visit_logs vl
         JOIN gate_passes gp ON gp.id = vl.gate_pass_id
         WHERE gp.pass_number = ? AND vl.status = 'ACTIVE'`,
        [pass_number]
      );
    }

    if (!logRows || !logRows.length) {
      conn.release();
      return sendError(res, 'No active visit found for checkout.', 404);
    }

    const visitLog       = logRows[0];
    const checkOutTime   = new Date();
    const checkInTime    = new Date(visitLog.check_in_at);
    const visitRequestId = visitLog.visit_request_id;

    // ── 2. Transaction: update log + request ──────────────────────────────────
    await conn.beginTransaction();

    await conn.query(
      `UPDATE visit_logs
       SET check_out_at = NOW(), status = 'COMPLETED', checked_out_by = ?, updated_at = NOW()
       WHERE id = ?`,
      [req.user.id, visitLog.id]
    );

    await conn.query(
      "UPDATE visit_requests SET status = 'COMPLETED', updated_at = NOW() WHERE id = ?",
      [visitRequestId]
    );

    await conn.commit();

    // ── 3. Audit log ──────────────────────────────────────────────────────────
    logAudit({
      db:        req.db,
      userId:    req.user.id,
      action:    'CHECK_OUT',
      module:    'GATE',
      recordType: 'VISIT_LOG',
      recordId:  visitLog.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    const durationMinutes = Math.round((checkOutTime - checkInTime) / 60000);

    return sendSuccess(res, {
      visit_log_id:     visitLog.id,
      visit_request_id: visitRequestId,
      check_in_at:      visitLog.check_in_at,
      check_out_at:     checkOutTime,
      duration_minutes: durationMinutes,
      checked_out_by:   req.user.id,
    }, 'Visitor checked out successfully.');
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[GateController] checkOut error:', err.message);
    return sendError(res, 'Check-out failed due to a server error.', 500);
  } finally {
    conn.release();
  }
};

// ── rejectAtGate ──────────────────────────────────────────────────────────────
/**
 * POST /api/gate/reject
 * Records a gate rejection. Uses gate_rejections table (qr_scan_logs removed).
 */
const rejectAtGate = async (req, res) => {
  try {
    const { visit_request_id, visitor_id, rejection_reason } = req.body;

    if (!rejection_reason || !rejection_reason.trim()) {
      return sendError(res, 'rejection_reason is required.', 400);
    }

    // Insert into gate_rejections
    const [insertResult] = await req.db.query(
      `INSERT INTO gate_rejections (visit_request_id, visitor_id, rejection_reason, rejected_by, rejected_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [
        visit_request_id || null,
        visitor_id       || null,
        rejection_reason.trim(),
        req.user.id,
      ]
    );

    // If a visit request was given, mark it REJECTED
    if (visit_request_id) {
      await req.db.query(
        "UPDATE visit_requests SET status = 'REJECTED', updated_at = NOW() WHERE id = ?",
        [visit_request_id]
      );
    }

    logAudit({
      db:        req.db,
      userId:    req.user.id,
      action:    'GATE_REJECT',
      module:    'GATE',
      recordType: 'VISIT_REQUEST',
      recordId:  visit_request_id || null,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    return sendSuccess(res, { rejection_id: insertResult.insertId }, 'Gate rejection recorded.', 201);
  } catch (err) {
    console.error('[GateController] rejectAtGate error:', err.message);
    return sendError(res, 'Failed to record gate rejection.', 500);
  }
};

// ── getActiveVisitors ─────────────────────────────────────────────────────────
const getActiveVisitors = async (req, res) => {
  try {
    const deptFilter = (isSuperAdmin(req.user) || isUnitAdmin(req.user) || ['security', 'receptionist', 'unit_auditor'].includes(req.user.role_type))
      ? ''
      : ` AND vr.department_id = ${parseInt(req.user.department_id, 10)} `;

    const [rows] = await req.db.query(
      `SELECT vl.id AS visit_log_id, vl.check_in_at,
              vl.id_verified_type, vl.id_verified_number,
              vr.id AS visit_request_id, vr.purpose, vr.visit_category,
              vr.visitor_name, vr.visitor_phone, vr.company_name,
              h.full_name  AS host_name,
              d.name       AS department_name,
              v.full_name  AS visitor_full_name,
              v.phone      AS verified_phone,
              gp.pass_number
       FROM visit_logs vl
       JOIN gate_passes    gp ON gp.id = vl.gate_pass_id
       JOIN visit_requests vr ON vr.id = vl.visit_request_id
       JOIN users           h  ON h.id  = vr.host_user_id
       JOIN departments     d  ON d.id  = vr.department_id
       LEFT JOIN visitors   v  ON v.id  = vr.visitor_id
       WHERE vl.status = 'ACTIVE'
         ${deptFilter}
       ORDER BY vl.check_in_at DESC`
    );

    return sendSuccess(res, rows, 'Active visitors retrieved successfully.');
  } catch (err) {
    console.error('[GateController] getActiveVisitors error:', err.message);
    return sendError(res, 'Failed to retrieve active visitors.', 500);
  }
};

module.exports = { getDashboard, checkIn, checkOut, rejectAtGate, getActiveVisitors };
