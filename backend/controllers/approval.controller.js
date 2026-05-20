// backend/controllers/approval.controller.js
'use strict';

const pool = require('../db');
const { sendSuccess, sendError } = require('../utils/response.util');
const { sendNotification } = require('../services/notification.service');
const emailService = require('../services/email.service');
const { logAudit } = require('../utils/auditLogger.util');
const { generateGatePass } = require('../services/gatePass.service');
const { isOrgAdmin, isDeptAdmin } = require('../middlewares/rbac.middleware');

const getInbox = async (req, res) => {
  try {
    const user = req.user;
    const [rows] = await pool.query(
      `SELECT vr.id AS visit_request_id, vr.visit_date, vr.purpose, vr.status,
              vr.visit_category AS visitor_type_code, vr.created_at AS assigned_at,
              v.full_name AS visitor_name, ru.full_name AS requester_name
         FROM visit_requests vr
         LEFT JOIN visitors v ON v.id = vr.visitor_id
         LEFT JOIN users ru ON ru.id = vr.requester_user_id
        WHERE vr.host_user_id = ? AND vr.status = 'PENDING'
        ORDER BY vr.created_at DESC`,
      [user.id]
    );
    const mappedRows = rows.map(r => ({ ...r, approval_id: r.visit_request_id, action: 'PENDING' }));
    return sendSuccess(res, mappedRows, 'Inbox fetched successfully.');
  } catch (err) {
    console.error('[ApprovalController] getInbox error:', err.message);
    return sendError(res, 'Failed to fetch approval inbox.', 500);
  }
};

const approveRequest = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params; // visit_request_id
    const { remarks } = req.body;
    const user = req.user;

    const [vrRows] = await conn.query(`SELECT vr.*, vr.visit_category as visitor_type_code FROM visit_requests vr WHERE vr.id = ?`, [id]);
    if (vrRows.length === 0) {
      conn.release();
      return sendError(res, 'Visit request not found.', 404);
    }
    const request = vrRows[0];

    const isHost = request.host_user_id === user.id;
    const canApprove = isHost || isOrgAdmin(user) || (isDeptAdmin(user) && request.department_id === user.department_id);

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
      `INSERT INTO approval_history (organization_id, visit_request_id, acted_by_user_id, action, remarks, created_at) VALUES (?, ?, ?, 'APPROVED', ?, NOW())`,
      [request.organization_id, id, user.id, remarks || null]
    );
    await conn.query(`UPDATE visit_requests SET status = 'APPROVED' WHERE id = ?`, [id]);
    await conn.commit();
    conn.release();

    // ── Auto-generate gate pass ───────────────────────────────────────────────
    let passResult = null;
    try {
      passResult = await generateGatePass(request.id, user.id);
    } catch (passErr) {
      console.error('[ApprovalController] Gate pass auto-generation failed:', passErr.message);
      // Non-fatal — approval already committed; log but continue
    }

    // ── Send approval email to visitor for all registered visitor types ───────
    if (['EMP', 'PRIOR', 'SPOT'].includes(request.visitor_type_code)) {
      let visitor = null;
      if (request.visitor_id) {
        const [vRows] = await pool.query(`SELECT full_name, email, phone FROM visitors WHERE id = ?`, [request.visitor_id]);
        visitor = vRows[0];
      } else if (request.requester_user_id) {
        const [uRows] = await pool.query(`SELECT full_name, email, phone FROM users WHERE id = ?`, [request.requester_user_id]);
        visitor = uRows[0];
      }
      const [oRows] = await pool.query(`SELECT name FROM organizations WHERE id = ?`, [request.organization_id]);
      const orgName = oRows[0]?.name || '';
      const [hostRows] = await pool.query(`SELECT full_name FROM users WHERE id = ?`, [request.host_user_id]);
      const hostName = hostRows[0]?.full_name || user.full_name;

      if (visitor) {
        // Build QR code URL using backend host (where uploads/ is served)
        const baseUrl = req ? `${req.protocol}://${req.get('host')}` : `http://localhost:${process.env.PORT || 5000}`;
        const qrCodeUrl = passResult?.qr_code_path
          ? `${baseUrl}/${passResult.qr_code_path}`
          : null;

        const tmpl = emailService.visitApprovedTemplate(
          visitor.full_name,
          hostName,
          request.visit_date,
          orgName,
          passResult?.pass_number || null,
          qrCodeUrl,
          request.visit_start_time || null
        );

        if (visitor.email) {
          await sendNotification({
            visitRequestId: request.id,
            recipientVisitorId: visitor.id,
            recipientEmail: visitor.email,
            type: 'EMAIL',
            subject: tmpl.subject,
            message: tmpl.html,
          });
        }
        if (visitor.phone) {
          const timeStr = request.visit_start_time ? ` at ${request.visit_start_time}` : '';
          const smsText = passResult?.pass_number
            ? `VMS: Your visit to ${orgName} on ${request.visit_date}${timeStr} has been APPROVED by ${hostName}. Gate Pass: ${passResult.pass_number}`
            : `VMS: Your visit to ${orgName} on ${request.visit_date}${timeStr} has been APPROVED by ${hostName}.`;
          await sendNotification({
            visitRequestId: request.id,
            recipientVisitorId: visitor.id,
            recipientPhone: visitor.phone,
            type: 'SMS',
            message: smsText,
          });
        }
      }
    }

    await sendNotification({ visitRequestId: request.id, type: 'DASHBOARD', message: `Visit request #${request.id} has been APPROVED by ${user.full_name}.` });
    await logAudit({ userId: user.id, action: 'APPROVE_REQUEST', module: 'APPROVAL', recordType: 'VISIT_REQUEST', recordId: request.id });

    return sendSuccess(res, null, 'Request approved successfully.');
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) {} conn.release(); }
    console.error('[ApprovalController] approveRequest error:', err.message);
    return sendError(res, 'Failed to approve request.', 500);
  }
};

const rejectRequest = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { remarks } = req.body;
    const user = req.user;

    if (!remarks) {
      conn.release();
      return sendError(res, 'Remarks are required when rejecting a request.', 400);
    }

    const [vrRows] = await conn.query(`SELECT vr.*, vr.visit_category as visitor_type_code FROM visit_requests vr WHERE vr.id = ?`, [id]);
    if (vrRows.length === 0) {
      conn.release();
      return sendError(res, 'Visit request not found.', 404);
    }
    const request = vrRows[0];

    const isHost = request.host_user_id === user.id;
    const canReject = isHost || isOrgAdmin(user) || (isDeptAdmin(user) && request.department_id === user.department_id);

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
      `INSERT INTO approval_history (organization_id, visit_request_id, acted_by_user_id, action, remarks, created_at) VALUES (?, ?, ?, 'REJECTED', ?, NOW())`,
      [request.organization_id, id, user.id, remarks]
    );
    await conn.query(`UPDATE visit_requests SET status = 'REJECTED' WHERE id = ?`, [id]);
    await conn.commit();
    conn.release();

    // ── Rejection: notify all registered visitor types ────────────────────────
    if (['EMP', 'PRIOR', 'SPOT'].includes(request.visitor_type_code)) {
      let visitor = null;
      if (request.visitor_id) {
        const [vRows] = await pool.query(`SELECT full_name, email, phone FROM visitors WHERE id = ?`, [request.visitor_id]);
        visitor = vRows[0];
      } else if (request.requester_user_id) {
        const [uRows] = await pool.query(`SELECT full_name, email, phone FROM users WHERE id = ?`, [request.requester_user_id]);
        visitor = uRows[0];
      }

      if (visitor) {
        const tmpl = emailService.visitRejectedTemplate(
          visitor.full_name, user.full_name, request.visit_date, remarks, request.visit_start_time || null
        );
        if (visitor.email) {
          await sendNotification({
            visitRequestId: request.id,
            recipientVisitorId: visitor.id,
            recipientEmail: visitor.email,
            type: 'EMAIL',
            subject: tmpl.subject,
            message: tmpl.html,
          });
        }
        if (visitor.phone) {
          const timeStr = request.visit_start_time ? ` at ${request.visit_start_time}` : '';
          await sendNotification({
            visitRequestId: request.id,
            recipientVisitorId: visitor.id,
            recipientPhone: visitor.phone,
            type: 'SMS',
            message: `VMS: Your visit request on ${request.visit_date}${timeStr} has been DECLINED. Reason: ${remarks}`,
          });
        }
      }
    }

    await sendNotification({ visitRequestId: request.id, type: 'DASHBOARD', message: `Visit request #${request.id} has been REJECTED by ${user.full_name}.` });
    await logAudit({ userId: user.id, action: 'REJECT_REQUEST', module: 'APPROVAL', recordType: 'VISIT_REQUEST', recordId: request.id });

    return sendSuccess(res, null, 'Request rejected successfully.');
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) {} conn.release(); }
    console.error('[ApprovalController] rejectRequest error:', err.message);
    return sendError(res, 'Failed to reject request.', 500);
  }
};

module.exports = { getInbox, approveRequest, rejectRequest };
