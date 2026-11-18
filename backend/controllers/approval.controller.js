// backend/controllers/approval.controller.js
'use strict';

const { sendSuccess, sendError } = require('../utils/response.util');
const { sendNotification } = require('../services/notification.service');
const emailService = require('../services/email.service');
const { logAudit } = require('../utils/auditLogger.util');
const { generateGatePass } = require('../services/gatePass.service');
const { isSuperAdmin, isUnitAdmin } = require('../middlewares/rbac.middleware');
const { emitToUnitSecurity, emitToUser, emitToUnitAdmins, emitGateChanged } = require('../socket/socketManager');
const { qrImageForPass } = require('../services/qrcode.service');
const { centralPool, getPool, CENTRAL_DB_NAME } = require('../services/dbManager');
const { unitActorId, findSuperAdminProfile } = require('../services/adminProfile.service');
const { whatsappText, appUrl, visitorPortalLink, isEmployeeVisit, VISITOR_NOTES } = require('../services/whatsapp.service');
const { formatDate, formatTime } = require('../utils/displayFormat.util');
const { unitLabel } = require('../utils/unitLabel.util');
const { expireForRequest, visitDay } = require('../services/visitExpiry.service');

/** Visit date for SMS / WhatsApp / dashboard text: "31 Oct 2026" (mysql2 returns a Date). */
const textDate = (d) => {
  const m = typeof d === 'string' && d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = m ? new Date(+m[1], +m[2] - 1, +m[3]) : d;
  return date instanceof Date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : String(d ?? '');
};
/** HH:MM from a TIME value, or null. */
const normalizeTime = (t) => (t ? String(t).slice(0, 5) : null);
/** Minutes since midnight (for start < end checks). */
const minutesOf = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
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
    visitor_name: rows[0].visitor_name,
    time_window: `${rows[0].visit_start_time} – ${rows[0].visit_end_time}`,
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

/**
 * Cross-unit EMPLOYEE_VISIT: the requester is an employee of another unit, stored
 * as cross_unit_requester_id + requester_unit_id (not requester_user_id). Tell them
 * the outcome in THEIR unit: dashboard + live socket event, and email unless they
 * already got the visitor email (same address). Never throws.
 */
/**
 * A request was decided: tell the host (when an admin decided for them) and the other
 * unit admins, so the request leaves their approval inboxes and bells at once.
 */
function actionedToOthers(req, request, approver, payload) {
  const unitDb = req.unitDbName || req.user.unit_db;
  const unitId = req.user.unit_id || request.unit_id;
  if (request.host_user_id && Number(request.host_user_id) !== Number(approver.id)) {
    emitToUser(request.host_user_id, unitDb, 'visit:actioned', payload);
  }
  emitToUnitAdmins(unitId, unitDb, 'visit:actioned', payload, [approver.id, request.host_user_id]);
}

/** Last 10 digits, for comparing mobile numbers. */
const last10 = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);

/**
 * Approval email + SMS to the unit staff on the visit: the employee who raised it
 * and the host (not unit admins — they follow visits in VMS). Skips the approver,
 * and anyone who already got the visitor's own message (e.g. an employee visiting).
 */
async function notifyStaffOfApproval(db, request, { approver, passResult, visitorName, visitorEmail, visitorPhone, rescheduled = false }) {
  // Only the people on this visit. Unit admins get no email / SMS / WhatsApp copy for
  // being admin — they see it in VMS (bell, dashboard) instead.
  const ids = [request.requester_user_id, request.host_user_id].filter(Boolean);
  if (!ids.length) return;
  const [staff] = await db.query(
    `SELECT id, full_name, email, phone FROM users
     WHERE is_active = 1 AND deleted_at IS NULL AND id <> ? AND id IN (?)`,
    [approver.id, ids]
  );

  const who      = visitorName || 'Visitor';
  const timeStr  = request.visit_start_time ? ` at ${request.visit_start_time}` : '';
  const passText = passResult?.pass_number ? ` Gate Pass: ${passResult.pass_number}` : '';
  const sms      = `VMS: Visit of ${who} on ${textDate(request.visit_date)}${timeStr} has been ${rescheduled ? 'RESCHEDULED and APPROVED' : 'APPROVED'} by ${approver.full_name}.${passText}`;

  await Promise.allSettled(staff.flatMap((s) => {
    const sends = [];
    if (s.email && s.email.toLowerCase() !== String(visitorEmail || '').toLowerCase()) {
      const tmpl = emailService.visitApprovedStaffTemplate(
        s.full_name, who, approver.full_name, request.visit_date, request.visit_start_time || null,
        passResult?.pass_number || null, request.purpose || null, rescheduled
      );
      sends.push(sendNotification({ db, visitRequestId: request.id, recipientUserId: s.id, recipientEmail: s.email, type: 'EMAIL', subject: tmpl.subject, message: tmpl.html }));
    }
    if (s.phone && last10(s.phone) !== last10(visitorPhone)) {
      sends.push(sendNotification({
        db, visitRequestId: request.id, recipientUserId: s.id, recipientPhone: s.phone, type: 'SMS', message: sms,
        whatsappMessage: whatsappText({
          title: rescheduled ? 'Visit rescheduled & approved' : 'Visit approved', name: s.full_name,
          intro: `The visit of ${who} has been ${rescheduled ? 'rescheduled and approved' : 'approved'} by ${approver.full_name}.`,
          details: [['Visitor', who], ['Date', formatDate(request.visit_date)], ['Time', formatTime(request.visit_start_time)],
            ['Purpose', request.purpose], ['Gate pass', passResult?.pass_number]],
          link: appUrl('/requests'), linkLabel: 'View in VMS',
        }),
      }));
    }
    return sends;
  }));
}

async function notifyCrossUnitRequester(request, { approved, actorName, remarks = null, passResult = null, passDb = null, unitText = null, rescheduled = false }) {
  if (!request.cross_unit_requester_id || !request.requester_unit_id) return;
  try {
    const [units] = await centralPool.query(
      "SELECT db_name FROM units WHERE id = ? AND is_active = 1 AND db_status = 'ACTIVE' LIMIT 1",
      [request.requester_unit_id]
    );
    if (!units.length) return;
    const requesterDbName = units[0].db_name;
    const requesterDb     = getPool(requesterDbName);
    const [[requester]] = await requesterDb.query(
      'SELECT id, full_name, email, phone FROM users WHERE id = ? AND is_active = 1 AND deleted_at IS NULL',
      [request.cross_unit_requester_id]
    );
    if (!requester) return;

    const timeStr = request.visit_start_time ? ` at ${request.visit_start_time}` : '';
    const message = approved
      ? `Your visit request on ${textDate(request.visit_date)}${timeStr} has been ${rescheduled ? 'RESCHEDULED and APPROVED' : 'APPROVED'} by ${actorName}.${passResult?.pass_number ? ` Gate pass: ${passResult.pass_number}` : ''}`
      : `Your visit request on ${textDate(request.visit_date)}${timeStr} has been REJECTED by ${actorName}. Reason: ${remarks}`;

    // visit_request_id stays NULL: the request lives in the other unit's DB
    await sendNotification({ db: requesterDb, recipientUserId: requester.id, type: 'DASHBOARD', message });
    if (requester.phone) {
      const when = [['Date', formatDate(request.visit_date)], ['Time', formatTime(request.visit_start_time)]];
      await sendNotification({
        db: requesterDb, recipientUserId: requester.id, recipientPhone: requester.phone, type: 'SMS', message: `VMS: ${message}`,
        whatsappMessage: whatsappText(approved
          ? { title: rescheduled ? 'Visit rescheduled & approved' : 'Visit approved', name: requester.full_name,
              intro: `Your visit request has been ${rescheduled ? 'rescheduled and approved' : 'approved'} by ${actorName}.`,
              details: [...when, ['Gate pass', passResult?.pass_number]],
              notes: passResult?.pass_number ? ['Show your gate pass at the security gate.', 'Carry your employee ID card.'] : [],
              link: appUrl('/requests'), linkLabel: 'View in VMS' }
          : { title: 'Visit request declined', name: requester.full_name, intro: `Your visit request has been declined by ${actorName}.`,
              details: [...when, ['Reason', remarks]], link: appUrl('/requests'), linkLabel: 'View in VMS' }),
      });
    }
    emitToUser(requester.id, requesterDbName, approved ? 'visit:approved' : 'visit:rejected', {
      visit_request_id: request.id,
      visit_date:       request.visit_date,
      visit_start_time: request.visit_start_time,
      visit_category:   request.visit_category,
      cross_unit_id:    request.unit_id,
      rescheduled:      !!rescheduled,
      ...(approved ? { approved_by: actorName, pass_number: passResult?.pass_number || null } : { rejected_by: actorName, remarks }),
    });

    if (requester.email && requester.email !== request.visitor_email) {
      if (approved) {
        // The queue attaches the gate pass when it sends (the pass lives in the host unit's DB)
        const tmpl = emailService.visitApprovedTemplate(
          requester.full_name, actorName, request.visit_date, unitText, passResult?.pass_number || null,
          passResult?.pass_number ? `cid:${emailService.GATE_PASS_QR_CID}` : null, request.visit_start_time || null, rescheduled
        );
        await sendNotification({ db: requesterDb, recipientUserId: requester.id, recipientEmail: requester.email, type: 'EMAIL', subject: tmpl.subject, message: tmpl.html, gatePass: passResult, gatePassDb: passDb });
      } else {
        const tmpl = emailService.visitRejectedTemplate(requester.full_name, actorName, request.visit_date, remarks, request.visit_start_time || null);
        await sendNotification({ db: requesterDb, recipientUserId: requester.id, recipientEmail: requester.email, type: 'EMAIL', subject: tmpl.subject, message: tmpl.html });
      }
    }
  } catch (err) {
    console.error('[ApprovalController] Cross-unit requester notification failed:', err.message);
  }
}


// ── getInbox ──────────────────────────────────────────────────────────────────
/**
 * GET /api/approvals/inbox?page=1&limit=10
 * Returns PENDING visit requests where the logged-in user is the host.
 * Dept admins can also see pending requests in their department.
 * Supports server-side pagination via page + limit query params.
 */
const getInbox = async (req, res) => {
  try {
    const personal = req.query.personal === '1' && isSuperAdmin(req.user);
    const personalProfile = personal ? await findSuperAdminProfile(req.user.id) : null;
    if (personal && !personalProfile) {
      return sendSuccess(res, { items: [], pagination: { page: 1, limit: 10, total: 0, pages: 0 } }, 'No unit employee profile.');
    }
    if (!personal) await expireForRequest(req);   // past-dated visits / passes → EXPIRED (once a day)
    const dbPool = personalProfile ? getPool(personalProfile.unit_db) : req.db;
    const user = req.user;

    // Super admins / global auditors on the central DB have no personal inbox.
    // But when managing a unit (X-Unit-Db or X-Unit-Id header sent by the frontend),
    // req.db is already switched to the unit pool — treat them like a unit_admin.
    const isManagingUnit = !personal &&
      (user.role_type === 'super_admin' || user.role_type === 'global_auditor') &&
      !!(req.headers['x-unit-db'] || req.headers['x-unit-id']);

    if (!personal && (user.role_type === 'super_admin' || user.role_type === 'global_auditor') && !isManagingUnit) {
      return sendSuccess(res, { items: [], pagination: { page: 1, limit: 10, total: 0, pages: 0 } }, 'Inbox fetched successfully.');
    }

    // Pagination params
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;

    const conditions = ["vr.status = 'PENDING'"];
    const params = [];

    if (personal) {
      // The super admin's own unit employee profile: requests they host.
      conditions.push('vr.host_user_id = ?');
      params.push(personalProfile.id);
    } else if (isUnitAdmin(user) || isManagingUnit) {
      // See all pending requests in their unit DB
    } else {
      // Regular employees see only requests where they are the host
      conditions.push('vr.host_user_id = ?');
      params.push(user.id);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // Count total matching rows
    const [[{ total }]] = await dbPool.query(
      `SELECT COUNT(*) AS total FROM visit_requests vr ${whereClause}`,
      params
    );

    const [rows] = await dbPool.query(
      `SELECT vr.id AS visit_request_id, vr.visit_date, vr.visit_start_time, vr.visit_end_time,
              vr.purpose, vr.status, vr.visit_category, vr.created_at AS assigned_at,
              vr.visitor_name, vr.visitor_phone, vr.company_name,
              h.full_name AS host_name,
              d.name AS department_name
       FROM visit_requests vr
       JOIN users h ON h.id = vr.host_user_id
       LEFT JOIN departments d ON d.id = vr.department_id
       ${whereClause}
       ORDER BY vr.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const items = rows.map(r => ({ ...r, approval_id: r.visit_request_id, action: 'PENDING' }));
    return sendSuccess(res, {
      items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    }, 'Inbox fetched successfully.');
  } catch (err) {
    console.error('[ApprovalController] getInbox error:', err.message);
    return sendError(res, 'Failed to fetch approval inbox.', 500);
  }
};

// ── approveRequest ────────────────────────────────────────────────────────────
const approveRequest = async (req, res) => {
  const personal = req.query.personal === '1' && isSuperAdmin(req.user);
  const personalProfile = personal ? await findSuperAdminProfile(req.user.id) : null;
  if (personal && !personalProfile) {
    return sendError(res, 'Join a unit as an employee from your Profile page before approving visits.', 403);
  }
  if (personalProfile) {
    req.db = getPool(personalProfile.unit_db);
    req.unitDbName = personalProfile.unit_db;
  }
  let conn = await req.db.getConnection();
  try {
    const { id } = req.params; // visit_request_id
    const { remarks, force_approve, reschedule, visit_date, visit_start_time, visit_end_time } = req.body;
    const user = req.user;
    const actorId = isSuperAdmin(user) ? await unitActorId(req.db, user) : user.id;
    if (isSuperAdmin(user) && !actorId) {
      conn.release();
      return sendError(res, 'Join a unit as an employee from your Profile page before approving visits.', 403);
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
    const isReschedule = reschedule === true;
    const originalVisitDate = request.visit_date;
    const originalStart = request.visit_start_time;
    const originalEnd = request.visit_end_time;

    // Permission check
    const isHost = request.host_user_id === actorId;
    const canApprove = isHost || isSuperAdmin(user) || isUnitAdmin(user);

    if (!canApprove) {
      conn.release();
      return sendError(res, 'You are not authorized to approve this request.', 403);
    }
    if (request.status !== 'PENDING') {
      conn.release();
      return sendError(res, 'This request has already been actioned.', 400);
    }

    // ── New date/time (reschedule & accept) ──────────────────────────────────
    const newDate = isReschedule ? (visit_date || null) : originalVisitDate;
    const newStart = isReschedule
      ? (visit_start_time === undefined ? normalizeTime(originalStart) : normalizeTime(visit_start_time))
      : normalizeTime(originalStart);
    const newEnd = isReschedule
      ? (visit_end_time === undefined ? normalizeTime(originalEnd) : normalizeTime(visit_end_time))
      : normalizeTime(originalEnd);

    if (isReschedule) {
      if (!newDate) {
        conn.release();
        return sendError(res, 'Select a new visit date.', 400);
      }
      if (visitDay(newDate) === 'past') {
        conn.release();
        return sendError(res, `The new visit date (${formatDate(newDate)}) has passed — choose today or a future date.`, 400);
      }
      if (newStart && newEnd && minutesOf(newEnd) <= minutesOf(newStart)) {
        conn.release();
        return sendError(res, 'The end time must be after the start time.', 400);
      }
    } else if (visitDay(originalVisitDate) === 'past') {
      conn.release();
      return sendError(res, `The visit date (${formatDate(originalVisitDate)}) has passed — this request can no longer be approved.`, 400);
    }

    // ── Schedule conflict check (only when visit has a time window) ──────────
    // Skip if force_approve:true (host confirmed they want to override)
    if (!force_approve && newStart && newEnd) {
      try {
        const conflict = await checkApprovalConflict(
          req.db,
          request.host_user_id,
          newDate,
          newStart,
          newEnd,
          request.id
        );
        if (conflict) {
          conn.release();
          return res.status(409).json({
            success: false,
            conflict: true,
            type: 'HOST_BUSY',
            host_conflict: conflict,
            message: `Schedule conflict: ${conflict.visitor_name} is already approved for the host during ${conflict.time_window}. Approve anyway with force_approve.`,
          });
        }
      } catch (conflictErr) {
        // Non-fatal — conflict check failure shouldn't block approval
        console.warn('[ApprovalController] Conflict check failed (non-fatal):', conflictErr.message);
      }
    }

    await conn.beginTransaction();
    // Conditional update first: only one of two simultaneous approve/reject
    // clicks can move the request out of PENDING
    let updated;
    if (isReschedule) {
      [updated] = await conn.query(
        `UPDATE visit_requests
         SET status = 'APPROVED', approved_by = ?, approved_at = NOW(),
             visit_date = ?, visit_start_time = ?, visit_end_time = ?, updated_at = NOW()
         WHERE id = ? AND status = 'PENDING'`,
        [actorId, newDate, newStart || null, newEnd || null, id]
      );
    } else {
      [updated] = await conn.query(
        "UPDATE visit_requests SET status = 'APPROVED', approved_by = ?, approved_at = NOW(), updated_at = NOW() WHERE id = ? AND status = 'PENDING'",
        [actorId, id]
      );
    }
    if (updated.affectedRows === 0) {
      await conn.rollback();
      conn.release();
      return sendError(res, 'This request has already been actioned.', 409);
    }
    const rescheduleNote = isReschedule
      ? `Rescheduled to ${formatDate(newDate)}${newStart ? ` at ${formatTime(newStart)}` : ''}`
      : null;
    const historyRemarks = [remarks?.trim(), rescheduleNote].filter(Boolean).join(' · ') || null;
    await conn.query(
      `INSERT INTO approval_history (visit_request_id, acted_by_user_id, action, remarks, created_at)
       VALUES (?, ?, 'APPROVED', ?, NOW())`,
      [id, actorId, historyRemarks]
    );
    await conn.commit();
    conn.release();
    conn = null;   // released: the catch below must not roll back / release it again (it may be serving another request by then)

    // Keep the in-memory record in sync for the pass, notifications and sockets.
    request.visit_date = newDate;
    request.visit_start_time = newStart;
    request.visit_end_time = newEnd;
    request.rescheduled = isReschedule;

    // ── Auto-generate gate pass (fast — local DB write + QR) ─────────────────
    let passResult = null;
    try {
      passResult = await generateGatePass(request.id, actorId, req.db);
    } catch (passErr) {
      console.error(
        `[ApprovalController] ⚠ Gate pass auto-generation FAILED for request #${request.id}:`,
        passErr.message, '|', passErr.code || ''
      );
      // Approval itself is already committed. Security staff can use the
      // manual "Generate Gate Pass" button on the request detail page.
    }

    // ── Respond immediately — don't make the client wait for emails/SMS ───────
    // Private bucket — the browser gets a short-lived signed link for the QR
    const gatePass = passResult && { ...passResult, qr_code_data: undefined, qr_code_path: await qrImageForPass(passResult) };
    sendSuccess(res, { gate_pass: gatePass }, isReschedule ? 'Request rescheduled and approved successfully.' : 'Request approved successfully.');

    // ── Socket.IO: push real-time updates ────────────────────────────────────
    const today = getISTDateString();
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
    const socketUnitDb = req.unitDbName || req.user.unit_db;
    const socketUnitId = req.user.unit_id || request.unit_id;
    emitToUser(actorId, socketUnitDb, 'visit:actioned', {
      visit_request_id: parseInt(id),
      action: 'APPROVED',
      rescheduled: isReschedule,
    });
    // ...and the host (an admin may approve for them) and the other unit admins, so their inboxes drop it
    actionedToOthers(req, request, { ...user, id: actorId }, { visit_request_id: parseInt(id), action: 'APPROVED', rescheduled: isReschedule });
    emitGateChanged(socketUnitId, 'approved');   // any day — the gate's upcoming list counts it

    // Notify security gate room if the approved visit is for today
    // NOTE: visit_requests table has no unit_id column — use req.user.unit_id
    // (the approver belongs to the same unit whose security needs the notification)
    if (visitDateStr === today) {
      emitToUnitSecurity(socketUnitId, 'visit:approved:today', {
        id: request.id,
        visitor_name: request.visitor_name,
        visitor_phone: request.visitor_phone,
        host_user_id: request.host_user_id,
        host_name: hostFullName,
        department_name: deptName,
        visit_date: request.visit_date,
        visit_start_time: request.visit_start_time,
        visit_end_time: request.visit_end_time,
        visit_category: request.visitor_type_code,
        status: 'APPROVED',
        purpose: request.purpose,
        pass_number: passResult?.pass_number || null,
      });
    }

    // Notify the requester if different from the approver
    if (request.requester_user_id && request.requester_user_id !== actorId) {
      emitToUser(request.requester_user_id, socketUnitDb, 'visit:approved', {
        visit_request_id: request.id,
        visitor_name: request.visitor_name || request.company_name || null,
        visit_date: request.visit_date,
        visit_start_time: request.visit_start_time,
        visit_category: request.visitor_type_code,
        approved_by: user.full_name || user.email,
        pass_number: passResult?.pass_number || null,
        rescheduled: isReschedule,
      });
    }

    // ── Fire notifications + audit in background (fire-and-forget) ────────────
    const notify = (opts) => sendNotification({ db: req.db, ...opts });
    // VENDOR here = a public "Business" request (staff-created vendor visits are
    // approved and emailed at creation), so fall back to the company/vendor fields
    const visitorName = request.visitor_name || request.company_name || null;
    const visitorEmail = request.visitor_email || request.vendor_email || null;
    const visitorPhone = request.visitor_phone || null;
    const timeStr = request.visit_start_time ? ` at ${request.visit_start_time}` : '';
    const unitText = await unitLabel(socketUnitId);   // "Unit 1, Bhubaneswar" — the unit the visitor goes to
    Promise.allSettled([
      // Email visitor — the queue attaches the real gate pass (and its QR in the body) when it sends
      ...(visitorEmail && ['EMPLOYEE_VISIT', 'SPOT', 'PERSONAL_VISIT', 'VENDOR'].includes(request.visitor_type_code)
        ? [(async () => {
          const qrCodeSrc = passResult?.pass_number ? `cid:${emailService.GATE_PASS_QR_CID}` : null;
          const tmpl = emailService.visitApprovedTemplate(
            visitorName || 'Visitor', hostFullName || user.full_name, request.visit_date, unitText,
            passResult?.pass_number || null, qrCodeSrc, request.visit_start_time || null, isReschedule
          );
          return notify({ visitRequestId: request.id, recipientEmail: visitorEmail, type: 'EMAIL', subject: tmpl.subject, message: tmpl.html, gatePass: passResult });
        })()]
        : []),
      // SMS visitor (+ WhatsApp copy with the gate-pass picture and the portal link)
      ...(visitorPhone ? [(() => {
        const actionWord = isReschedule ? 'RESCHEDULED and APPROVED' : 'APPROVED';
        const message = passResult?.pass_number
          ? `VMS: Your visit on ${textDate(request.visit_date)}${timeStr} has been ${actionWord} by ${user.full_name}. Gate Pass: ${passResult.pass_number}`
          : `VMS: Your visit on ${textDate(request.visit_date)}${timeStr} has been ${actionWord} by ${user.full_name}.`;
        return notify({
          visitRequestId: request.id, recipientPhone: visitorPhone, type: 'SMS',
          message, gatePass: passResult,
          push: {
            title: isReschedule ? 'Visit rescheduled & approved' : 'Visit approved',
            body: `Your visit on ${[formatDate(request.visit_date), formatTime(request.visit_start_time)].filter(Boolean).join(', ')} to meet ${hostFullName || user.full_name} is ${isReschedule ? 'rescheduled and approved' : 'approved'}.${passResult?.pass_number ? ` Gate pass ${passResult.pass_number} — show it at the gate.` : ''}`,
          },
          whatsappMessage: whatsappText({
            title: isReschedule ? 'Visit rescheduled & approved' : 'Visit approved', name: visitorName,
            intro: `Your visit request has been ${isReschedule ? 'rescheduled and approved' : 'approved'} by ${user.full_name}.${passResult?.pass_number ? ' Your gate pass follows in the next message.' : ''}`,
            details: [['Gate pass', passResult?.pass_number], ['Date', formatDate(request.visit_date)],
              ['Time', formatTime(request.visit_start_time)], ['To meet', hostFullName], ['Unit', unitText], ['Purpose', request.purpose]],
            notes: passResult?.pass_number ? VISITOR_NOTES : ['Carry a valid government photo ID.'],
            link: visitorPortalLink(request.visitor_type_code),   // none for an employee's visit
          }),
        });
      })()] : []),
      // Dashboard — requester
      ...(request.requester_user_id && request.requester_user_id !== actorId
        ? [notify({ visitRequestId: request.id, recipientUserId: request.requester_user_id, type: 'DASHBOARD', message: `Your visit request #${request.id} on ${textDate(request.visit_date)}${timeStr} has been ${isReschedule ? 'RESCHEDULED and APPROVED' : 'APPROVED'} by ${user.full_name}.` })]
        : []),
      // Dashboard — generic
      notify({ visitRequestId: request.id, type: 'DASHBOARD', message: `Visit request #${request.id} has been ${isReschedule ? 'RESCHEDULED and APPROVED' : 'APPROVED'} by ${user.full_name}.` }),
      // Email + SMS — requester, host and unit admins
      notifyStaffOfApproval(req.db, request, { approver: user, passResult, visitorName, visitorEmail, visitorPhone, rescheduled: isReschedule }),
      // Cross-unit requester (lives in another unit's DB)
      notifyCrossUnitRequester(request, { approved: true, actorName: user.full_name, passResult, passDb: req.db, unitText, rescheduled: isReschedule }),
      // Audit log
      logAudit({
        db: req.db, userId: actorId,
        action: isReschedule ? 'RESCHEDULE_APPROVE_REQUEST' : 'APPROVE_REQUEST',
        module: 'APPROVAL', recordType: 'VISIT_REQUEST', recordId: request.id,
        newValues: isReschedule ? {
          rescheduled: true,
          visit_date: newDate,
          visit_start_time: newStart,
          visit_end_time: newEnd,
          previous_visit_date: originalVisitDate,
          previous_visit_start_time: originalStart,
          previous_visit_end_time: originalEnd,
        } : undefined,
        ipAddress: req.ip, userAgent: req.headers['user-agent'] || null,
      }),
    ]).catch(err => console.error('[ApprovalController] Background task error:', err.message));

  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) { } conn.release(); }
    console.error('[ApprovalController] approveRequest error:', err.message);
    return sendError(res, 'Failed to approve request.', 500);
  }
};

// ── rejectRequest ─────────────────────────────────────────────────────────────
const rejectRequest = async (req, res) => {
  const personal = req.query.personal === '1' && isSuperAdmin(req.user);
  const personalProfile = personal ? await findSuperAdminProfile(req.user.id) : null;
  if (personal && !personalProfile) {
    return sendError(res, 'Join a unit as an employee from your Profile page before rejecting visits.', 403);
  }
  if (personalProfile) {
    req.db = getPool(personalProfile.unit_db);
    req.unitDbName = personalProfile.unit_db;
  }
  let conn = await req.db.getConnection();
  try {
    const { id } = req.params;
    const { remarks } = req.body;
    const user = req.user;
    const actorId = isSuperAdmin(user) ? await unitActorId(req.db, user) : user.id;
    if (isSuperAdmin(user) && !actorId) {
      conn.release();
      return sendError(res, 'Join a unit as an employee from your Profile page before rejecting visits.', 403);
    }

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

    const isHost = request.host_user_id === actorId;
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
    // Conditional update first (see approveRequest)
    const [updated] = await conn.query(
      "UPDATE visit_requests SET status = 'REJECTED', updated_at = NOW() WHERE id = ? AND status = 'PENDING'",
      [id]
    );
    if (updated.affectedRows === 0) {
      await conn.rollback();
      conn.release();
      return sendError(res, 'This request has already been actioned.', 409);
    }
    await conn.query(
      `INSERT INTO approval_history (visit_request_id, acted_by_user_id, action, remarks, created_at)
       VALUES (?, ?, 'REJECTED', ?, NOW())`,
      [id, actorId, remarks.trim()]
    );
    await conn.commit();
    conn.release();
    conn = null;   // released: the catch below must not roll back / release it again (it may be serving another request by then)

    // ── Respond immediately — don't make the client wait for emails/SMS ───────
    sendSuccess(res, null, 'Request rejected successfully.');

    // ── Socket: notify the rejecter's own views ──────────────────────────────
    const socketUnitDb = req.unitDbName || req.user.unit_db;
    const socketUnitId = req.user.unit_id || request.unit_id;
    emitToUser(actorId, socketUnitDb, 'visit:actioned', {
      visit_request_id: parseInt(id),
      action: 'REJECTED',
      visit_category: request.visitor_type_code,
    });
    actionedToOthers(req, request, { ...user, id: actorId }, { visit_request_id: parseInt(id), action: 'REJECTED' });
    emitGateChanged(socketUnitId, 'rejected');   // e.g. a walk-in security registered (Spot Visits)

    // ── Socket: notify requester of rejection ────────────────────────────────
    if (request.requester_user_id) {
      emitToUser(request.requester_user_id, socketUnitDb, 'visit:rejected', {
        visit_request_id: parseInt(id),
        visitor_name: request.visitor_name || request.company_name || null,
        visit_category: request.visitor_type_code,
        remarks: remarks.trim(),
        rejected_by: user.full_name || user.email,
      });
    }

    // ── Fire notifications + audit in background (fire-and-forget) ────────────
    const notify = (opts) => sendNotification({ db: req.db, ...opts });
    const visitorName = request.visitor_name || null;
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
        message: `VMS: Your visit request on ${textDate(request.visit_date)}${timeStr} has been DECLINED. Reason: ${remarks.trim()}`,
        push: {
          title: 'Visit request declined',
          body: `Your visit on ${formatDate(request.visit_date)}${hostInfo.full_name ? ` to meet ${hostInfo.full_name}` : ''} was declined. Reason: ${remarks.trim()}`,
        },
        whatsappMessage: whatsappText({
          title: 'Visit request declined', name: visitorName,
          intro: 'We regret to inform you that your visit request has been declined.',
          details: [['Date', formatDate(request.visit_date)], ['Time', formatTime(request.visit_start_time)],
            ['To meet', hostInfo.full_name], ['Reason', remarks.trim()]],
          notes: [isEmployeeVisit(request.visitor_type_code)
            ? 'You may raise a fresh request in VMS.'
            : 'You may submit a fresh request on the visitor portal.'],
          link: visitorPortalLink(request.visitor_type_code), linkLabel: 'Visitor portal',
        }),
      })] : []),

      // 5. Dashboard — requester
      ...(request.requester_user_id && request.requester_user_id !== actorId
        ? [notify({ visitRequestId: request.id, recipientUserId: request.requester_user_id, type: 'DASHBOARD', message: `Your visit request #${request.id} on ${textDate(request.visit_date)}${timeStr} has been REJECTED. Reason: ${remarks.trim()}` })]
        : []),

      // 6. Dashboard — generic
      notify({ visitRequestId: request.id, type: 'DASHBOARD', message: `Visit request #${request.id} has been REJECTED by ${user.full_name}.` }),

      // 6b. Cross-unit requester (lives in another unit's DB)
      notifyCrossUnitRequester(request, { approved: false, actorName: user.full_name, remarks: remarks.trim() }),

      // 7. Audit log
      logAudit({ db: req.db, userId: actorId, action: 'REJECT_REQUEST', module: 'APPROVAL', recordType: 'VISIT_REQUEST', recordId: request.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] || null }),
    ]).catch(err => console.error('[ApprovalController] Background task error:', err.message));

  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) { } conn.release(); }
    console.error('[ApprovalController] rejectRequest error:', err.message);
    return sendError(res, 'Failed to reject request.', 500);
  }
};

// ── getUserNotifications ──────────────────────────────────────────────────────
const getUserNotifications = async (req, res) => {
  try {
    const user = req.user;
    if (!user?.id) return sendSuccess(res, [], 'No notifications.');

    let db = req.db;
    let targetId = user.id;

    if (user.role_type === 'super_admin') {
      // Always show the super admin's unit employee-profile notifications,
      // regardless of which unit is currently being managed.
      const profile = await findSuperAdminProfile(user.id);
      if (!profile) return sendSuccess(res, [], 'No unit employee profile.');
      db = getPool(profile.unit_db);
      targetId = profile.id;
    } else if (user.unit_db === 'central' || user.unit_db === CENTRAL_DB_NAME) {
      return sendSuccess(res, [], 'No notifications.');
    }
    if (!db) return sendSuccess(res, [], 'No notifications.');

    const [rows] = await db.query(
      `SELECT n.id, n.visit_request_id, n.message, n.subject, n.created_at,
              vr.visit_date, vr.visit_start_time, vr.visit_category, vr.status AS visit_status,
              gp.pass_number
       FROM notifications n
       LEFT JOIN visit_requests vr ON vr.id = n.visit_request_id
       LEFT JOIN gate_passes gp ON gp.visit_request_id = vr.id
       WHERE n.recipient_user_id = ? AND n.notification_type = 'DASHBOARD'
       ORDER BY n.created_at DESC
       LIMIT 20`,
      [targetId]
    );
    return sendSuccess(res, rows, 'Notifications fetched successfully.');
  } catch (err) {
    console.error('[ApprovalController] getUserNotifications error:', err.message);
    return sendSuccess(res, [], 'Empty notifications.');
  }
};

module.exports = { getInbox, approveRequest, rejectRequest, getUserNotifications };
