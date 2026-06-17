// backend/controllers/approval.controller.js
'use strict';

const { sendSuccess, sendError }       = require('../utils/response.util');
const { sendNotification }             = require('../services/notification.service');
const emailService                     = require('../services/email.service');
const { logAudit }                     = require('../utils/auditLogger.util');
const { generateGatePass }             = require('../services/gatePass.service');
const { isSuperAdmin, isUnitAdmin }    = require('../middlewares/rbac.middleware');
const { emitToUnitSecurity, emitToUser } = require('../socket/socketManager');

// ── Inline schedule conflict check for the approval flow ─────────────────────
// Checks if the host already has another APPROVED visit overlapping the given time.
const checkApprovalConflict = async (db, hostUserId, visitDate, startTime, endTime, excludeRequestId) => {
  if (!startTime || !endTime) return null;
  const [rows] = await db.query(
    `SELECT vr.id, vr.visit_start_time, vr.visit_end_time,
            COALESCE(vr.visitor_name, 'Unknown Visitor') AS visitor_name
     FROM visit_requests vr
     WHERE vr.host_user_id = ?
       AND vr.visit_date   = ?
       AND vr.status       = 'APPROVED'
       AND vr.id          != ?
       AND vr.visit_start_time IS NOT NULL
       AND vr.visit_end_time   IS NOT NULL
       AND vr.visit_start_time < ?
       AND vr.visit_end_time   > ?
     LIMIT 1`,
    [hostUserId, visitDate, excludeRequestId, endTime, startTime]
  );
  if (!rows.length) return null;
  return {
    clashing_request_id: rows[0].id,
    visitor_name:        rows[0].visitor_name,
    time_window:         `${rows[0].visit_start_time} – ${rows[0].visit_end_time}`,
  };
};

const getISTDateString = (d = new Date()) => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
};


// ── getInbox ──────────────────────────────────────────────────────────────────
/**
 * GET /api/approvals/inbox
 * Returns PENDING visit requests where the logged-in user is the host.
 * Dept admins can also see pending requests in their department.
 */
const getInbox = async (req, res) => {
  try {
    const user = req.user;

    // Super admins / global auditors on the central DB have no personal inbox.
    // But when managing a unit (X-Unit-Db or X-Unit-Id header sent by the frontend),
    // req.db is already switched to the unit pool — treat them like a unit_admin.
    const isManagingUnit =
      (user.role_type === 'super_admin' || user.role_type === 'global_auditor') &&
      !!(req.headers['x-unit-db'] || req.headers['x-unit-id']);

    if ((user.role_type === 'super_admin' || user.role_type === 'global_auditor') && !isManagingUnit) {
      return sendSuccess(res, [], 'Inbox fetched successfully.');
    }

    const conditions = ["vr.status = 'PENDING'"];
    const params     = [];

    if (isUnitAdmin(user) || isManagingUnit) {
      // See all pending requests in their unit DB

    } else {

      // Regular employees see only requests where they are the host
      conditions.push('vr.host_user_id = ?');
      params.push(user.id);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const [rows] = await req.db.query(
      `SELECT vr.id AS visit_request_id, vr.visit_date, vr.visit_start_time,
              vr.purpose, vr.status, vr.visit_category, vr.created_at AS assigned_at,
              vr.visitor_name, vr.visitor_phone, vr.company_name,
              h.full_name AS host_name,
              d.name AS department_name
       FROM visit_requests vr
       JOIN users h ON h.id = vr.host_user_id
       LEFT JOIN departments d ON d.id = vr.department_id
       ${whereClause}
       ORDER BY vr.created_at DESC`,
      params
    );

    const mappedRows = rows.map(r => ({ ...r, approval_id: r.visit_request_id, action: 'PENDING' }));
    return sendSuccess(res, mappedRows, 'Inbox fetched successfully.');
  } catch (err) {
    console.error('[ApprovalController] getInbox error:', err.message);
    return sendError(res, 'Failed to fetch approval inbox.', 500);
  }
};

// ── approveRequest ────────────────────────────────────────────────────────────
const approveRequest = async (req, res) => {
  const conn = await req.db.getConnection();
  try {
    const { id } = req.params; // visit_request_id
    const { remarks, force_approve } = req.body;
    const user = req.user;

    const [vrRows] = await conn.query(
      `SELECT vr.*, vr.visit_category AS visitor_type_code FROM visit_requests vr WHERE vr.id = ?`,
      [id]
    );
    if (vrRows.length === 0) {
      conn.release();
      return sendError(res, 'Visit request not found.', 404);
    }
    const request = vrRows[0];

    // Permission check
    const isHost    = request.host_user_id === user.id;
    const canApprove = isHost || isSuperAdmin(user) || isUnitAdmin(user);

    if (!canApprove) {
      conn.release();
      return sendError(res, 'You are not authorized to approve this request.', 403);
    }
    if (request.status !== 'PENDING') {
      conn.release();
      return sendError(res, 'This request has already been actioned.', 400);
    }

    // ── Schedule conflict check (only when visit has a time window) ──────────
    // Skip if force_approve:true (host confirmed they want to override)
    if (!force_approve && request.visit_start_time && request.visit_end_time) {
      try {
        const conflict = await checkApprovalConflict(
          req.db,
          request.host_user_id,
          request.visit_date,
          request.visit_start_time,
          request.visit_end_time,
          request.id
        );
        if (conflict) {
          conn.release();
          return res.status(409).json({
            success:        false,
            conflict:       true,
            type:           'HOST_BUSY',
            host_conflict:  conflict,
            message:        `Schedule conflict: ${conflict.visitor_name} is already approved for the host during ${conflict.time_window}. Approve anyway with force_approve.`,
          });
        }
      } catch (conflictErr) {
        // Non-fatal — conflict check failure shouldn't block approval
        console.warn('[ApprovalController] Conflict check failed (non-fatal):', conflictErr.message);
      }
    }

    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO approval_history (visit_request_id, acted_by_user_id, action, remarks, created_at)
       VALUES (?, ?, 'APPROVED', ?, NOW())`,
      [id, user.id, remarks || null]
    );
    await conn.query(
      "UPDATE visit_requests SET status = 'APPROVED', approved_by = ?, approved_at = NOW(), updated_at = NOW() WHERE id = ?",
      [user.id, id]
    );
    await conn.commit();
    conn.release();

    // ── Auto-generate gate pass (fast — local DB write + QR) ─────────────────
    let passResult = null;
    try {
      passResult = await generateGatePass(request.id, user.id, req.db);
    } catch (passErr) {
      console.error('[ApprovalController] Gate pass auto-generation failed:', passErr.message);
    }

    // ── Respond immediately — don't make the client wait for emails/SMS ───────
    sendSuccess(res, { gate_pass: passResult }, 'Request approved successfully.');

    // ── Socket.IO: push real-time updates ────────────────────────────────────
    const today        = getISTDateString();
    const visitDateStr = getISTDateString(new Date(request.visit_date));

    // Resolve host name and department name for the socket payload
    let hostFullName = null;
    let deptName = null;
    try {
      const [hostRows] = await req.db.query(
        'SELECT full_name FROM users WHERE id = ? LIMIT 1',
        [request.host_user_id]
      );
      hostFullName = hostRows[0]?.full_name ?? null;

      if (request.department_id) {
        const [deptRows] = await req.db.query(
          'SELECT name FROM departments WHERE id = ? LIMIT 1',
          [request.department_id]
        );
        deptName = deptRows[0]?.name ?? null;
      }
    } catch (lookupErr) {
      console.warn('[ApprovalController] Could not resolve host/dept for socket payload:', lookupErr.message);
    }

    // Notify the APPROVER's own other views (dashboard, approval inbox) so they update
    emitToUser(user.id, req.user.unit_db, 'visit:actioned', {
      visit_request_id: parseInt(id),
      action: 'APPROVED',
    });

    // Notify security gate room if the approved visit is for today
    // NOTE: visit_requests table has no unit_id column — use req.user.unit_id
    // (the approver belongs to the same unit whose security needs the notification)
    if (visitDateStr === today) {
      emitToUnitSecurity(req.user.unit_id, 'visit:approved:today', {
        id:               request.id,
        visitor_name:     request.visitor_name,
        visitor_phone:    request.visitor_phone,
        host_user_id:     request.host_user_id,
        host_name:        hostFullName,
        department_name:  deptName,
        visit_date:       request.visit_date,
        visit_start_time: request.visit_start_time,
        visit_end_time:   request.visit_end_time,
        visit_category:   request.visitor_type_code,
        status:           'APPROVED',
        purpose:          request.purpose,
        pass_number:      passResult?.pass_number || null,
      });
    }

    // Notify the requester if different from the approver
    if (request.requester_user_id && request.requester_user_id !== user.id) {
      emitToUser(request.requester_user_id, req.user.unit_db, 'visit:approved', {
        visit_request_id: request.id,
        visit_date:       request.visit_date,
        visit_category:   request.visitor_type_code,
        approved_by:      user.full_name || user.email,
        pass_number:      passResult?.pass_number || null,
      });
    }

    // ── Fire notifications + audit in background (fire-and-forget) ────────────
    const notify = (opts) => sendNotification({ db: req.db, ...opts });
    const visitorName  = request.visitor_name  || null;
    const visitorEmail = request.visitor_email || null;
    const visitorPhone = request.visitor_phone || null;
    const timeStr = request.visit_start_time ? ` at ${request.visit_start_time}` : '';
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const qrCodeUrl = passResult?.qr_code_path ? `${baseUrl}/${passResult.qr_code_path}` : null;

    Promise.allSettled([
      // Email visitor
      ...(visitorEmail && ['EMPLOYEE_VISIT','SPOT','PERSONAL_VISIT'].includes(request.visitor_type_code)
        ? [(() => {
            const tmpl = emailService.visitApprovedTemplate(
              visitorName || 'Visitor', user.full_name, request.visit_date, '',
              passResult?.pass_number || null, qrCodeUrl, request.visit_start_time || null
            );
            return notify({ visitRequestId: request.id, recipientEmail: visitorEmail, type: 'EMAIL', subject: tmpl.subject, message: tmpl.html });
          })()]
        : []),
      // SMS visitor
      ...(visitorPhone ? [notify({
        visitRequestId: request.id, recipientPhone: visitorPhone, type: 'SMS',
        message: passResult?.pass_number
          ? `VMS: Your visit on ${request.visit_date}${timeStr} has been APPROVED by ${user.full_name}. Gate Pass: ${passResult.pass_number}`
          : `VMS: Your visit on ${request.visit_date}${timeStr} has been APPROVED by ${user.full_name}.`,
      })] : []),
      // Dashboard — requester
      ...(request.requester_user_id && request.requester_user_id !== user.id
        ? [notify({ visitRequestId: request.id, recipientUserId: request.requester_user_id, type: 'DASHBOARD', message: `Your visit request #${request.id} on ${request.visit_date}${timeStr} has been APPROVED by ${user.full_name}.` })]
        : []),
      // Dashboard — generic
      notify({ visitRequestId: request.id, type: 'DASHBOARD', message: `Visit request #${request.id} has been APPROVED by ${user.full_name}.` }),
      // Audit log
      logAudit({ db: req.db, userId: user.id, action: 'APPROVE_REQUEST', module: 'APPROVAL', recordType: 'VISIT_REQUEST', recordId: request.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] || null }),
    ]).catch(err => console.error('[ApprovalController] Background task error:', err.message));

  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) {} conn.release(); }
    console.error('[ApprovalController] approveRequest error:', err.message);
    return sendError(res, 'Failed to approve request.', 500);
  }
};

// ── rejectRequest ─────────────────────────────────────────────────────────────
const rejectRequest = async (req, res) => {
  const conn = await req.db.getConnection();
  try {
    const { id } = req.params;
    const { remarks } = req.body;
    const user = req.user;

    if (!remarks || !remarks.trim()) {
      conn.release();
      return sendError(res, 'Remarks are required when rejecting a request.', 400);
    }

    const [vrRows] = await conn.query(
      `SELECT vr.*, vr.visit_category AS visitor_type_code FROM visit_requests vr WHERE vr.id = ?`,
      [id]
    );
    if (vrRows.length === 0) {
      conn.release();
      return sendError(res, 'Visit request not found.', 404);
    }
    const request = vrRows[0];

    const isHost    = request.host_user_id === user.id;
    const canReject = isHost || isSuperAdmin(user) || isUnitAdmin(user);

    if (!canReject) {
      conn.release();
      return sendError(res, 'You are not authorized to reject this request.', 403);
    }
    if (request.status !== 'PENDING') {
      conn.release();
      return sendError(res, 'This request has already been actioned.', 400);
    }

    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO approval_history (visit_request_id, acted_by_user_id, action, remarks, created_at)
       VALUES (?, ?, 'REJECTED', ?, NOW())`,
      [id, user.id, remarks.trim()]
    );
    await conn.query(
      "UPDATE visit_requests SET status = 'REJECTED', updated_at = NOW() WHERE id = ?",
      [id]
    );
    await conn.commit();
    conn.release();

    // ── Respond immediately — don't make the client wait for emails/SMS ───────
    sendSuccess(res, null, 'Request rejected successfully.');

    // ── Socket: notify the rejecter's own views ──────────────────────────────
    emitToUser(user.id, req.user.unit_db, 'visit:actioned', {
      visit_request_id: parseInt(id),
      action: 'REJECTED',
      visit_category:   request.visitor_type_code,
    });

    // ── Socket: notify requester of rejection ────────────────────────────────
    if (request.requester_user_id) {
      emitToUser(request.requester_user_id, req.user.unit_db, 'visit:rejected', {
        visit_request_id: parseInt(id),
        visit_category:   request.visitor_type_code,
        remarks:          remarks.trim(),
        rejected_by:      user.full_name || user.email,
      });
    }

    // ── Fire notifications + audit in background (fire-and-forget) ────────────
    const notify = (opts) => sendNotification({ db: req.db, ...opts });
    const visitorName  = request.visitor_name  || null;
    const visitorEmail = request.visitor_email || request.vendor_email || null; // vendor fallback
    const visitorPhone = request.visitor_phone || null;
    const timeStr = request.visit_start_time ? ` at ${request.visit_start_time}` : '';

    // Fetch host + requester details for emails
    const [hostRejectRows] = await req.db.query(
      'SELECT full_name, email FROM users WHERE id = ?', [request.host_user_id]
    );
    const hostInfo = hostRejectRows[0] || {};

    let requesterInfo = null;
    if (request.requester_user_id && request.requester_user_id !== request.host_user_id) {
      const [reqRows] = await req.db.query(
        'SELECT full_name, email FROM users WHERE id = ?', [request.requester_user_id]
      );
      requesterInfo = reqRows[0] || null;
    }

    const makeRejectedEmail = (recipientName, recipientEmail) => {
      const tmpl = emailService.visitRejectedTemplate(
        recipientName || 'Visitor', user.full_name, request.visit_date, remarks.trim(), request.visit_start_time || null
      );
      return notify({ visitRequestId: request.id, recipientEmail, type: 'EMAIL', subject: tmpl.subject, message: tmpl.html });
    };

    Promise.allSettled([
      // 1. Email visitor (or vendor contact)
      ...(visitorEmail ? [makeRejectedEmail(visitorName || 'Visitor', visitorEmail)] : []),

      // 2. Email the internal requester employee (if different from visitor and has email)
      ...(requesterInfo?.email && requesterInfo.email !== visitorEmail
        ? [makeRejectedEmail(`${requesterInfo.full_name} (your request)`, requesterInfo.email)]
        : []),

      // 3. Email host if they were NOT the one who rejected (i.e. admin rejected on their behalf)
      ...(!isHost && hostInfo.email && hostInfo.email !== visitorEmail && hostInfo.email !== requesterInfo?.email
        ? [makeRejectedEmail(`${hostInfo.full_name} (FYI)`, hostInfo.email)]
        : []),

      // 4. SMS visitor
      ...(visitorPhone ? [notify({
        visitRequestId: request.id, recipientPhone: visitorPhone, type: 'SMS',
        message: `VMS: Your visit request on ${request.visit_date}${timeStr} has been DECLINED. Reason: ${remarks.trim()}`,
      })] : []),

      // 5. Dashboard — requester
      ...(request.requester_user_id && request.requester_user_id !== user.id
        ? [notify({ visitRequestId: request.id, recipientUserId: request.requester_user_id, type: 'DASHBOARD', message: `Your visit request #${request.id} on ${request.visit_date}${timeStr} has been REJECTED. Reason: ${remarks.trim()}` })]
        : []),

      // 6. Dashboard — generic
      notify({ visitRequestId: request.id, type: 'DASHBOARD', message: `Visit request #${request.id} has been REJECTED by ${user.full_name}.` }),

      // 7. Audit log
      logAudit({ db: req.db, userId: user.id, action: 'REJECT_REQUEST', module: 'APPROVAL', recordType: 'VISIT_REQUEST', recordId: request.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] || null }),
    ]).catch(err => console.error('[ApprovalController] Background task error:', err.message));

  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) {} conn.release(); }
    console.error('[ApprovalController] rejectRequest error:', err.message);
    return sendError(res, 'Failed to reject request.', 500);
  }
};

module.exports = { getInbox, approveRequest, rejectRequest };
