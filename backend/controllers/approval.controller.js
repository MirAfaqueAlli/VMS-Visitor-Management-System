// backend/controllers/approval.controller.js
'use strict';

const { sendSuccess, sendError } = require('../utils/response.util');
const { sendNotification }       = require('../services/notification.service');
const emailService               = require('../services/email.service');
const { logAudit }               = require('../utils/auditLogger.util');
const { generateGatePass }       = require('../services/gatePass.service');
const { isSuperAdmin, isUnitAdmin } = require('../middlewares/rbac.middleware');

// ── getInbox ──────────────────────────────────────────────────────────────────
/**
 * GET /api/approvals/inbox
 * Returns PENDING visit requests where the logged-in user is the host.
 * Dept admins can also see pending requests in their department.
 */
const getInbox = async (req, res) => {
  try {
    const user = req.user;
    if (user.role_type === 'super_admin' || user.role_type === 'global_auditor') {
      return sendSuccess(res, [], 'Inbox fetched successfully.');
    }

    const conditions = ["vr.status = 'PENDING'"];
    const params     = [];

    if (isUnitAdmin(user)) {
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
    const { remarks } = req.body;
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
    const canApprove = isHost
      || isSuperAdmin(user)
      || isUnitAdmin(user);

    if (!canApprove) {
      conn.release();
      return sendError(res, 'You are not authorized to approve this request.', 403);
    }
    if (request.status !== 'PENDING') {
      conn.release();
      return sendError(res, 'This request has already been actioned.', 400);
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

    // ── Auto-generate gate pass ───────────────────────────────────────────────
    let passResult = null;
    try {
      passResult = await generateGatePass(request.id, user.id, req.db);
    } catch (passErr) {
      console.error('[ApprovalController] Gate pass auto-generation failed:', passErr.message);
    }

    // ── Notify visitor using inline fields (visitor_id may not be set yet) ────
    const visitorName  = request.visitor_name  || null;
    const visitorEmail = request.visitor_email || null;
    const visitorPhone = request.visitor_phone || null;

    if (['EMPLOYEE_VISIT', 'EMP', 'PRIOR', 'SPOT', 'PERSONAL_VISIT', 'INTER_UNIT_VISIT'].includes(request.visitor_type_code)) {
      const baseUrl = req ? `${req.protocol}://${req.get('host')}` : `http://localhost:${process.env.PORT || 5000}`;
      const qrCodeUrl = passResult?.qr_code_path ? `${baseUrl}/${passResult.qr_code_path}` : null;
      const timeStr = request.visit_start_time ? ` at ${request.visit_start_time}` : '';

      if (visitorEmail) {
        const tmpl = emailService.visitApprovedTemplate(
          visitorName || 'Visitor',
          user.full_name,
          request.visit_date,
          '',
          passResult?.pass_number || null,
          qrCodeUrl,
          request.visit_start_time || null
        );
        await sendNotification({
          db: req.db,
          visitRequestId:     request.id,
          recipientEmail:     visitorEmail,
          type:               'EMAIL',
          subject:            tmpl.subject,
          message:            tmpl.html,
        });
      }

      if (visitorPhone) {
        const smsText = passResult?.pass_number
          ? `VMS: Your visit on ${request.visit_date}${timeStr} has been APPROVED by ${user.full_name}. Gate Pass: ${passResult.pass_number}`
          : `VMS: Your visit on ${request.visit_date}${timeStr} has been APPROVED by ${user.full_name}.`;
        await sendNotification({
          db: req.db,
          visitRequestId: request.id,
          recipientPhone: visitorPhone,
          type:           'SMS',
          message:        smsText,
        });
      }

      // Also notify the requester (could be a different user for PRIOR / EMP)
      if (request.requester_user_id && request.requester_user_id !== user.id) {
        await sendNotification({
          db: req.db,
          visitRequestId:   request.id,
          recipientUserId:  request.requester_user_id,
          type:             'DASHBOARD',
          message:          `Your visit request #${request.id} on ${request.visit_date}${timeStr} has been APPROVED by ${user.full_name}.`,
        });
      }
    }

    await sendNotification({
      db: req.db,
      visitRequestId: request.id,
      type:           'DASHBOARD',
      message:        `Visit request #${request.id} has been APPROVED by ${user.full_name}.`,
    });

    await logAudit({
      db:        req.db,
      userId:    user.id,
      action:    'APPROVE_REQUEST',
      module:    'APPROVAL',
      recordType: 'VISIT_REQUEST',
      recordId:  request.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    return sendSuccess(res, { gate_pass: passResult }, 'Request approved successfully.');
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
    const canReject = isHost
      || isSuperAdmin(user)
      || isUnitAdmin(user);

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

    // ── Notify visitor using inline fields ────────────────────────────────────
    const visitorName  = request.visitor_name  || null;
    const visitorEmail = request.visitor_email || null;
    const visitorPhone = request.visitor_phone || null;
    const timeStr = request.visit_start_time ? ` at ${request.visit_start_time}` : '';

    if (visitorEmail) {
      const tmpl = emailService.visitRejectedTemplate(
        visitorName || 'Visitor', user.full_name, request.visit_date, remarks.trim(), request.visit_start_time || null
      );
      await sendNotification({
        db: req.db,
        visitRequestId: request.id,
        recipientEmail: visitorEmail,
        type:           'EMAIL',
        subject:        tmpl.subject,
        message:        tmpl.html,
      });
    }

    if (visitorPhone) {
      await sendNotification({
        db: req.db,
        visitRequestId: request.id,
        recipientPhone: visitorPhone,
        type:           'SMS',
        message:        `VMS: Your visit request on ${request.visit_date}${timeStr} has been DECLINED. Reason: ${remarks.trim()}`,
      });
    }

    // Also notify the requester if different from host/visitor
    if (request.requester_user_id && request.requester_user_id !== user.id) {
      await sendNotification({
        db: req.db,
        visitRequestId:  request.id,
        recipientUserId: request.requester_user_id,
        type:            'DASHBOARD',
        message:         `Your visit request #${request.id} on ${request.visit_date}${timeStr} has been REJECTED. Reason: ${remarks.trim()}`,
      });
    }

    await sendNotification({
      db: req.db,
      visitRequestId: request.id,
      type:           'DASHBOARD',
      message:        `Visit request #${request.id} has been REJECTED by ${user.full_name}.`,
    });

    await logAudit({
      db:        req.db,
      userId:    user.id,
      action:    'REJECT_REQUEST',
      module:    'APPROVAL',
      recordType: 'VISIT_REQUEST',
      recordId:  request.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    return sendSuccess(res, null, 'Request rejected successfully.');
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) {} conn.release(); }
    console.error('[ApprovalController] rejectRequest error:', err.message);
    return sendError(res, 'Failed to reject request.', 500);
  }
};

module.exports = { getInbox, approveRequest, rejectRequest };
