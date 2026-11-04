// backend/controllers/gate.controller.js
'use strict';

const { sendSuccess, sendError } = require('../utils/response.util');
const { logAudit }               = require('../utils/auditLogger.util');
const { isSuperAdmin, isUnitAdmin, canViewFullIdNumbers } = require('../middlewares/rbac.middleware');
const { emitToUnitSecurity, emitToUser } = require('../socket/socketManager');
const { verifyQRToken }          = require('../utils/qrToken.util');
const { encryptField, decryptField, decryptRows } = require('../utils/crypto.util');
const { uploadToS3, getSignedFileUrl } = require('../utils/s3.util');
const { sendNotification }       = require('../services/notification.service');
const { escapeHtml: esc, noticeMessage } = require('../services/email.service');
const { whatsappText }           = require('../services/whatsapp.service');
const { visitDay }               = require('../services/visitExpiry.service');
const { visitorOnRecord }        = require('../services/visitorRecord.service');
const { squarePhoto }            = require('../utils/photo.util');
const { formatDate }             = require('../utils/displayFormat.util');


// ── getDashboard ──────────────────────────────────────────────────────────────
const getDashboard = async (req, res) => {
  try {
    // Employees see only visits they host; every other role allowed on this route
    // (admins, gate staff, auditors) sees the whole unit. Parameterised — previously
    // department_id was pasted into the SQL and became NaN (crash) for users without one.
    const isEmployee  = req.user.role_type === 'employee';
    const scopeSql    = isEmployee ? ' AND vr.host_user_id = ? ' : '';
    const scopeParams = isEmployee ? [req.user.id] : [];

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
           ${scopeSql}
           AND (gp.status IS NULL OR gp.status = 'ISSUED')
         ORDER BY vr.visit_start_time ASC`, scopeParams
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
           ${scopeSql}
         ORDER BY vl.check_in_at DESC`, scopeParams
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
           ${scopeSql}
         ORDER BY vl.check_out_at DESC`, scopeParams
      ),

      // Pending Approvals for Today
      req.db.query(
        `SELECT vr.id, vr.purpose, vr.visit_date, vr.visitor_name, vr.visitor_phone,
                h.full_name AS host_name
         FROM visit_requests vr
         JOIN users h ON h.id = vr.host_user_id
         WHERE vr.visit_date = CURDATE() AND vr.status = 'PENDING'
           ${scopeSql}
         ORDER BY vr.created_at ASC`, scopeParams
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
  let conn = await req.db.getConnection();
  try {
    const requestId = parseInt(req.params.requestId, 10);
    if (isNaN(requestId)) { conn.release(); return sendError(res, 'Invalid request ID.', 400); }

    const { remarks, pass_number } = req.body;
    let { id_verified_type, id_verified_number } = req.body;

    // Upload visitor photo to S3 if provided; store the returned public URL
    let visitorPhotoPath = null;
    if (req.file) {
      try {
        const photo = await squarePhoto(req.file.buffer);   // 800 × 800, centre-cropped
        visitorPhotoPath = await uploadToS3({
          buffer:   photo.buffer,
          mimeType: photo.mimeType,
          folder:   'visitor-photos',
          filename: `photo-${Date.now()}-${requestId}.${photo.ext}`,
        });
      } catch (s3Err) {
        console.error('[Gate] Failed to upload visitor photo to S3:', s3Err.message);
        // Non-fatal — allow check-in to proceed without photo
      }
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

    // An ID already on record (request, portal profile or an earlier visit) is what the
    // card is checked against — the gate can't replace it, only enter one when there is none
    const onRecord = await visitorOnRecord(req.db, request);
    if (onRecord.id_proof_type) {
      id_verified_type   = onRecord.id_proof_type;
      id_verified_number = onRecord.id_proof_number;
    }

    // ID check: required for visitors; optional for an employee visiting (they carry the staff ID card)
    const hasId = !!(id_verified_type && String(id_verified_number || '').trim());
    if (!hasId && request.visit_category !== 'EMPLOYEE_VISIT') {
      conn.release();
      return sendError(res, "Enter the visitor's ID type and number.", 400);
    }

    if (!request.gate_pass_id) {
      conn.release();
      return sendError(res, 'Gate pass not generated yet. Generate a pass first.', 400);
    }
    if (request.pass_status !== 'ISSUED') {
      conn.release();
      return sendError(res, 'Gate pass has already been used or cancelled.', 400);
    }
    // The visit itself must still be on (a cancelled / rejected visit can't enter)
    if (request.status === 'EXPIRED' || (['APPROVED', 'SCHEDULED'].includes(request.status) && visitDay(request.visit_date) === 'past')) {
      conn.release();
      return sendError(res, `This gate pass has expired — the visit date (${formatDate(request.visit_date)}) has passed.`, 403);
    }
    if (!['APPROVED', 'SCHEDULED'].includes(request.status)) {
      conn.release();
      return sendError(res, `This visit is ${String(request.status).toLowerCase()} — the visitor can't be checked in.`, 403);
    }
    if (request.pass_number !== pass_number) {
      conn.release();
      return sendError(res, 'Gate pass number mismatch. Verification failed.', 403);
    }

    // Verify visit date is strictly today — compared as IST calendar dates, so it
    // doesn't depend on the server's timezone (EC2 defaults to UTC)
    if (visitDay(request.visit_date) === 'future') {
      conn.release();
      return sendError(res, `Not today: this visit is booked for ${formatDate(request.visit_date)}. Check-in is allowed only on the visit date.`, 403);
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
         WHERE RIGHT(REGEXP_REPLACE(v.phone, '[^0-9]', ''), 10) = RIGHT(REGEXP_REPLACE(?, '[^0-9]', ''), 10) AND bv.is_active = TRUE LIMIT 1`,
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
    const visitorType = (request.visit_category === 'VENDOR' || request.company_name) ? 'business' : 'individual';

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
             address      = COALESCE(?, address),
             visitor_type = ?,
             updated_at   = NOW()
           WHERE id = ?`,
          [request.visitor_name || null, request.visitor_email || null, request.visitor_address || null, visitorType, visitorId]
        );
      } else {
        // Create new visitor record
        const [insertVis] = await req.db.query(
          `INSERT INTO visitors (full_name, phone, email, address, visitor_type, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
          [request.visitor_name || 'Unknown', request.visitor_phone, request.visitor_email || null, request.visitor_address || null, visitorType]
        );
        visitorId = insertVis.insertId;
      }
    }

    // ── 4. ID proof check — if visitor already has a registered ID of this type, verify it
    if (visitorId && hasId) {
      const [idProofRows] = await req.db.query(
        `SELECT id_number FROM visitor_documents WHERE visitor_id = ? AND id_type = ? LIMIT 1`,
        [visitorId, id_verified_type]
      );
      if (idProofRows.length > 0) {
        // Decrypt stored value before comparing with what was presented at gate
        const storedNumber = decryptField(idProofRows[0].id_number);
        if (storedNumber !== id_verified_number) {
          conn.release();
          return sendError(res, `ID Mismatch: The provided ${id_verified_type} does not match our records for this visitor.`, 400);
        }
      }
      // Store ID doc if not already there (INSERT IGNORE respects the unique constraint)
      // Encrypt before storing
      await req.db.query(
        `INSERT IGNORE INTO visitor_documents (visitor_id, id_type, id_number, is_primary, created_at) VALUES (?, ?, ?, TRUE, NOW())`,
        [visitorId, id_verified_type, encryptField(id_verified_number)]
      );
    }

    // ── 5. Transaction: update visit_request.visitor_id + insert visit_log + update gate pass ──
    await conn.beginTransaction();

    // Mark the gate pass USED first, and only if it is still ISSUED — so two
    // simultaneous scans of the same pass can't both check the visitor in.
    // Also starts the 24-hour QR validity window.
    const [passClaim] = await conn.query(
      "UPDATE gate_passes SET status = 'USED', qr_expires_at = DATE_ADD(NOW(), INTERVAL 24 HOUR) WHERE id = ? AND status = 'ISSUED'",
      [request.gate_pass_id]
    );
    if (passClaim.affectedRows === 0) {
      await conn.rollback();
      conn.release();
      return sendError(res, 'Gate pass has already been used or cancelled.', 409);
    }

    // Link visitor to visit request if we just resolved/created one
    if (visitorId && !request.visitor_id) {
      await conn.query(
        'UPDATE visit_requests SET visitor_id = ?, updated_at = NOW() WHERE id = ?',
        [visitorId, requestId]
      );
    }

    // No photo at the gate → keep the one on record (request, portal profile or last visit)
    if (!visitorPhotoPath) visitorPhotoPath = onRecord.photo_path;

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
        hasId ? id_verified_type : null,
        hasId ? encryptField(String(id_verified_number).trim()) : null,   // encrypt before persisting
        remarks || null,
      ]
    );
    const visitLogId = logInsert.insertId;

    await conn.commit();
    conn.release();
    conn = null;   // released: the catch below must not roll back / release it again (it may be serving another request by then)

    // ── Socket.IO: notify all security/gate users that a visitor just checked in ─
    // Fetch host and dept name for the payload (reuse data we already have)
    const [hostInfoRows] = await req.db.query(
      'SELECT full_name FROM users WHERE id = ?', [request.host_user_id]
    );
    const [deptInfoRows] = await req.db.query(
      'SELECT name FROM departments WHERE id = ?', [request.department_id]
    );

    const hostName = hostInfoRows[0]?.full_name || null;

    emitToUnitSecurity(req.user.unit_id, 'visit:checkin', {
      visit_request_id: requestId,
      visitor_name:     request.visitor_name,
      visitor_phone:    request.visitor_phone,
      pass_number:      request.pass_number,
      host_name:        hostName,
      department_name:  deptInfoRows[0]?.name || null,
      check_in_at:      new Date().toISOString(),
      visit_log_id:     visitLogId,
    });

    // Notify the host user directly
    if (request.host_user_id) {
      emitToUser(request.host_user_id, req.user.unit_db, 'visit:checkin', {
        visit_request_id: requestId,
        visitor_name:     request.visitor_name,
        visitor_phone:    request.visitor_phone,
        pass_number:      request.pass_number,
        host_name:        hostName,
        department_name:  deptInfoRows[0]?.name || null,
        check_in_at:      new Date().toISOString(),
        visit_log_id:     visitLogId,
      });

      // SMS/email/dashboard to host so they know even if not in the app
      setImmediate(async () => {
        try {
          const [hostRows] = await req.db.query(
            'SELECT id, full_name, email, phone FROM users WHERE id = ?', [request.host_user_id]
          );
          if (!hostRows || hostRows.length === 0) return;
          const host = hostRows[0];
          const checkInAt = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
          if (host.phone) {
            await sendNotification({
              db: req.db, visitRequestId: requestId,
              recipientUserId: host.id, recipientPhone: host.phone,
              type: 'SMS',
              message: `OHPC VMS: ${request.visitor_name} has checked in at the gate to meet you. Check-in time: ${checkInAt} IST. Pass: ${request.pass_number || 'N/A'}.`,
              whatsappMessage: whatsappText({
                title: 'Visitor at the gate', name: host.full_name,
                intro: `${request.visitor_name} has checked in at the gate to meet you.`,
                details: [['Visitor', request.visitor_name], ['Mobile', request.visitor_phone],
                  ['Checked in', `${checkInAt} IST`], ['Gate pass', request.pass_number]],
                notes: ['Please receive your visitor at the reception.'],
              }),
            });
          }
          if (host.email) {
            await sendNotification({
              db: req.db, visitRequestId: requestId,
              recipientUserId: host.id, recipientEmail: host.email,
              type: 'EMAIL',
              ...noticeMessage({
                title: 'Visitor at the gate', name: host.full_name,
                subject: `Visitor arrived: ${request.visitor_name}`,
                preheader: `${request.visitor_name} has checked in at the gate to meet you.`,
                paragraphs: [`<strong>${esc(request.visitor_name)}</strong> has checked in at the gate to meet you. Please receive your visitor at the reception.`],
                rows: [['Visitor', request.visitor_name], ['Mobile', request.visitor_phone],
                  ['Checked in at', `${checkInAt} IST`], ['Gate pass number', request.pass_number, { mono: true }]],
                status: { label: 'CHECKED IN', tone: 'success' },
                ref: request.pass_number,
              }),
            });
          }
          await sendNotification({
            db: req.db, visitRequestId: requestId,
            recipientUserId: host.id,
            type: 'DASHBOARD',
            message: `${request.visitor_name} has checked in at the gate (Pass: ${request.pass_number || 'N/A'}) at ${checkInAt}.`,
          });
        } catch (checkInNotifyErr) {
          console.error('[GateController] check-in host notification error:', checkInNotifyErr.message);
        }
      });
    }

    // ── Meeting conflict detection ─────────────────────────────────────────────
    // Check if the same host already has another ACTIVE visit log (i.e. is currently
    // in a meeting with a different visitor). If so, alert security immediately.
    setImmediate(async () => {
      try {
        const [conflictRows] = await req.db.query(
          `SELECT vr.visitor_name, vr.id AS visit_request_id
           FROM visit_logs vl
           JOIN gate_passes    gp ON gp.id = vl.gate_pass_id
           JOIN visit_requests vr ON vr.id = gp.visit_request_id
           WHERE vl.status = 'ACTIVE'
             AND vr.host_user_id = ?
             AND vl.id != ?
           LIMIT 1`,
          [request.host_user_id, visitLogId]
        );

        if (conflictRows.length > 0) {
          const conflicting = conflictRows[0];
          emitToUnitSecurity(req.user.unit_id, 'visit:conflict:meeting', {
            new_visit_request_id:        requestId,
            new_visitor_name:            request.visitor_name,
            conflicting_visit_request_id: conflicting.visit_request_id,
            conflicting_visitor_name:    conflicting.visitor_name,
            host_name:                   hostName,
            host_user_id:                request.host_user_id,
            detected_at:                 new Date().toISOString(),
          });
          console.warn(
            `[GateController] Meeting conflict: host #${request.host_user_id} (${hostName})` +
            ` already in meeting with "${conflicting.visitor_name}" when "${request.visitor_name}" checked in.`
          );
        }
      } catch (conflictErr) {
        console.error('[GateController] conflict detection error:', conflictErr.message);
      }
    });


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

    // Private bucket — return a short-lived signed link for the photo
    const visitLog = logRows[0] && { ...logRows[0], visitor_photo_path: await getSignedFileUrl(logRows[0].visitor_photo_path) };
    return sendSuccess(res, visitLog, 'Visitor checked in successfully.');
  } catch (err) {
    // Only touch the connection if we still hold it — once released (conn = null
    // above) it may be serving another request, and a ROLLBACK here would undo
    // that request's transaction.
    if (conn) {
      try { await conn.rollback(); } catch (_) {}
      conn.release();
    }
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

    // Direct checkout ends the pass at once, like a QR checkout: the visit is over,
    // so neither the pass nor its QR may be used again
    await conn.query(
      `UPDATE gate_passes
       SET status = 'EXPIRED', checkout_method = 'DIRECT', qr_expires_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [visitLog.gate_pass_id]
    );

    await conn.commit();

    // ── Socket.IO: notify all security/gate users that a visitor checked out ───
    // Fetch visitor_name from visit_requests so the OS notification shows the real name
    let checkoutVisitorName = null;
    try {
      const [vrName] = await req.db.query(
        'SELECT visitor_name FROM visit_requests WHERE id = ?', [visitRequestId]
      );
      checkoutVisitorName = vrName[0]?.visitor_name || null;
    } catch (_) { /* non-fatal — keep name null */ }

    emitToUnitSecurity(req.user.unit_id, 'visit:checkout', {
      visit_log_id:     visitLog.id,
      visit_request_id: visitRequestId,
      visitor_name:     checkoutVisitorName,
      check_out_at:     checkOutTime.toISOString(),
    });

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

    let insertResult;
    const conn = await req.db.getConnection();
    try {
      await conn.beginTransaction();

      // A visit can only be refused before entry (PENDING / APPROVED) — never one
      // that is already checked in, completed, rejected or cancelled
      if (visit_request_id) {
        const [updated] = await conn.query(
          `UPDATE visit_requests SET status = 'REJECTED', updated_at = NOW()
           WHERE id = ? AND status IN ('PENDING', 'APPROVED')`,
          [visit_request_id]
        );
        if (updated.affectedRows === 0) {
          await conn.rollback();
          return sendError(res, 'This visit can no longer be refused at the gate (already checked in, completed, rejected or cancelled).', 409);
        }
        // The refused visitor's unused pass must not work later
        await conn.query(
          "UPDATE gate_passes SET status = 'CANCELLED' WHERE visit_request_id = ? AND status = 'ISSUED'",
          [visit_request_id]
        );
      }

      [insertResult] = await conn.query(
        `INSERT INTO gate_rejections (visit_request_id, visitor_id, rejection_reason, rejected_by, rejected_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [
          visit_request_id || null,
          visitor_id       || null,
          rejection_reason.trim(),
          req.user.id,
        ]
      );
      await conn.commit();
    } catch (txErr) {
      try { await conn.rollback(); } catch (_) {}
      throw txErr;
    } finally {
      conn.release();
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
    // Every role allowed on this route (admins, gate staff, auditors) sees the whole
    // unit. The old department filter only ever applied to global_auditor, whose
    // department_id is NULL — it produced "department_id = NaN" and crashed.
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
       ORDER BY vl.check_in_at DESC`
    );

    // Auditors can read this list too — they get masked ID numbers
    return sendSuccess(
      res,
      decryptRows(rows, ['id_verified_number'], { mask: !canViewFullIdNumbers(req.user) }),
      'Active visitors retrieved successfully.'
    );
  } catch (err) {
    console.error('[GateController] getActiveVisitors error:', err.message);
    return sendError(res, 'Failed to retrieve active visitors.', 500);
  }
};

// ── checkOutByQR ──────────────────────────────────────────────────────────────
/**
 * POST /api/gate/checkout/qr
 *
 * Checkout via QR scan. The visitor presents the same QR code used during check-in.
 * - Gate pass must be USED and within its 24-hour validity window (qr_expires_at > NOW()).
 * - ID verification must match the original check-in ID number.
 * - On success: gate pass status = EXPIRED (immediately invalidated), checkout_method = QR_SCAN.
 */
const checkOutByQR = async (req, res) => {
  const conn = await req.db.getConnection();
  try {
    const { pass_number } = req.body;

    if (!pass_number) {
      return sendError(res, 'pass_number is required.', 400);
    }

    // ── 0. Verify the HMAC-SHA256 signature on the QR token ──────────────────
    // The QR image encodes a signed token, not raw JSON.
    // If the token is a signed token (contains '.'), verify it.
    // If someone sends just a raw pass_number string from a forged source,
    // we still look it up in the DB — the DB gate_pass status guards that path.
    let resolvedPassNumber = pass_number.trim().toUpperCase();

    if (pass_number.includes('.')) {
      // Looks like a signed QR token — verify the HMAC signature
      const { valid, payload, error } = verifyQRToken(pass_number.trim());

      if (!valid) {
        console.warn(`[GateController] QR signature verification FAILED: ${error}`);
        return sendError(res, `Invalid QR code: ${error}`, 403);
      }

      // Extract the pass_number from the verified payload
      if (!payload.pass_number) {
        return sendError(res, 'QR token payload is missing pass_number.', 400);
      }

      resolvedPassNumber = payload.pass_number.trim().toUpperCase();
      console.info(`[GateController] QR token verified ✓ — pass: ${resolvedPassNumber}`);
    }

    const [passRows] = await req.db.query(
      `SELECT gp.*, vr.id AS visit_request_id
       FROM gate_passes gp
       JOIN visit_requests vr ON vr.id = gp.visit_request_id
       WHERE gp.pass_number = ? AND gp.status = 'USED'
       LIMIT 1`,
      [resolvedPassNumber]
    );

    if (!passRows.length) {
      return sendError(res, 'Gate pass not found or not in a checked-in state.', 404);
    }

    const gatePass = passRows[0];

    // ── 2. Validate QR is within its 24-hour validity window ──────────────────
    if (!gatePass.qr_expires_at || new Date() > new Date(gatePass.qr_expires_at)) {
      return sendError(res, 'QR code has expired (24-hour window elapsed). Use direct checkout.', 410);
    }

    // ── 3. Find the active visit log for this gate pass ───────────────────────
    const [logRows] = await req.db.query(
      `SELECT * FROM visit_logs WHERE gate_pass_id = ? AND status = 'ACTIVE' LIMIT 1`,
      [gatePass.id]
    );

    if (!logRows.length) {
      return sendError(res, 'No active visit found for this gate pass.', 404);
    }

    const visitLog = logRows[0];

    // ID verification removed — QR code match is sufficient for checkout

    const checkOutTime   = new Date();
    const checkInTime    = new Date(visitLog.check_in_at);
    const visitRequestId = visitLog.visit_request_id;

    // ── 5. Transaction: complete checkout + expire QR ─────────────────────────
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

    // QR checkout: immediately expire the gate pass so it cannot be reused
    await conn.query(
      `UPDATE gate_passes
       SET status = 'EXPIRED', checkout_method = 'QR_SCAN', qr_expires_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [gatePass.id]
    );

    await conn.commit();

    // ── Socket.IO: notify security ────────────────────────────────────────────
    let checkoutVisitorName = null;
    try {
      const [vrName] = await req.db.query(
        'SELECT visitor_name FROM visit_requests WHERE id = ?', [visitRequestId]
      );
      checkoutVisitorName = vrName[0]?.visitor_name || null;
    } catch (_) {}

    emitToUnitSecurity(req.user.unit_id, 'visit:checkout', {
      visit_log_id:     visitLog.id,
      visit_request_id: visitRequestId,
      visitor_name:     checkoutVisitorName,
      check_out_at:     checkOutTime.toISOString(),
      checkout_method:  'QR_SCAN',
    });

    // ── Audit log ─────────────────────────────────────────────────────────────
    logAudit({
      db:        req.db,
      userId:    req.user.id,
      action:    'CHECK_OUT_QR',
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
      checkout_method:  'QR_SCAN',
      checked_out_by:   req.user.id,
    }, 'Visitor checked out via QR scan. Gate pass has been invalidated.');

  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[GateController] checkOutByQR error:', err.message);
    return sendError(res, 'QR checkout failed due to a server error.', 500);
  } finally {
    conn.release();
  }
};

// ── lookupPass ────────────────────────────────────────────────────────────────
/**
 * POST /api/gate/lookup { code }  — a scanned QR (signed token) or a typed pass number.
 * Says whether the visitor can be checked in now, and why not:
 *   verdict: 'ok' | 'future' | 'expired' | 'inside' | 'used' | 'cancelled' | 'not_approved'
 * A visitor who comes on another day than the one booked is caught here, before check-in.
 */
const lookupPass = async (req, res) => {
  try {
    const code = String(req.body.code || '').trim();
    if (!code) return sendError(res, 'Scan the QR code or enter the gate pass number.', 400);

    let passNumber = code.toUpperCase();
    if (code.includes('.')) {
      const check = verifyQRToken(code);
      if (!check.valid) return sendError(res, 'This QR code is not a valid OHPC gate pass.', 400);
      passNumber = String(check.payload.pass_number || '').toUpperCase();
    }

    const [rows] = await req.db.query(
      `SELECT vr.id, vr.status, vr.visit_date, vr.visit_start_time, vr.visit_category,
              COALESCE(vr.visitor_name, vr.company_name) AS visitor_name, vr.company_name,
              gp.pass_number, gp.status AS pass_status, h.full_name AS host_name,
              (SELECT vl.status FROM visit_logs vl WHERE vl.visit_request_id = vr.id ORDER BY vl.id DESC LIMIT 1) AS log_status,
              (SELECT vl.check_in_at FROM visit_logs vl WHERE vl.visit_request_id = vr.id ORDER BY vl.id DESC LIMIT 1) AS check_in_at
         FROM gate_passes gp
         JOIN visit_requests vr ON vr.id = gp.visit_request_id
         LEFT JOIN users h ON h.id = vr.host_user_id
        WHERE gp.pass_number = ? LIMIT 1`,
      [passNumber]
    );
    if (!rows.length) return sendError(res, `No gate pass ${passNumber} was issued in this unit.`, 404);

    const v = rows[0];
    const date = formatDate(v.visit_date);
    const day = visitDay(v.visit_date);
    let verdict = 'ok';
    let message = `Valid for today. ${v.visitor_name || 'The visitor'} can be checked in.`;

    if (v.log_status === 'ACTIVE') {
      verdict = 'inside';
      message = `${v.visitor_name || 'This visitor'} is already inside — checked in at ${new Date(v.check_in_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}.`;
    } else if (v.log_status || v.status === 'COMPLETED') {
      verdict = 'used';
      message = 'This gate pass has already been used — the visit is over. A new visit needs a new pass.';
    } else if (['CANCELLED', 'REJECTED'].includes(v.status) || v.pass_status === 'CANCELLED') {
      verdict = 'cancelled';
      message = `This visit was ${v.status === 'REJECTED' ? 'declined' : 'cancelled'} — the visitor can't be let in on this pass.`;
    } else if (v.status === 'EXPIRED' || v.pass_status === 'EXPIRED' || day === 'past') {
      verdict = 'expired';
      message = `This gate pass has expired. The visit was booked for ${date} — it can't be used today.`;
    } else if (day === 'future') {
      verdict = 'future';
      message = `Not today. This visit is booked for ${date}. Check-in is allowed only on the visit date.`;
    } else if (!['APPROVED', 'SCHEDULED'].includes(v.status)) {
      verdict = 'not_approved';
      message = 'This visit has not been approved yet — the visitor can\'t be checked in.';
    }

    return sendSuccess(res, {
      verdict, message,
      request_id: v.id, pass_number: v.pass_number, visitor_name: v.visitor_name, company_name: v.company_name,
      host_name: v.host_name, visit_date: v.visit_date, visit_start_time: v.visit_start_time,
      visit_day: day, status: v.status, pass_status: v.pass_status,
    }, message);
  } catch (err) {
    console.error('[GateController] lookupPass error:', err.message);
    return sendError(res, 'Could not check this gate pass. Please try again.', 500);
  }
};

module.exports = { getDashboard, checkIn, checkOut, checkOutByQR, rejectAtGate, getActiveVisitors, lookupPass };
