// backend/controllers/visitRequest.controller.js
'use strict';

const { centralPool, getPool } = require('../services/dbManager');
const { sendSuccess, sendError } = require('../utils/response.util');
const { sendNotification }       = require('../services/notification.service');
const emailService               = require('../services/email.service');
const { logAudit }               = require('../utils/auditLogger.util');
const { generateGatePass }       = require('../services/gatePass.service');
const { isSuperAdmin, isUnitAdmin } = require('../middlewares/rbac.middleware');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * isBlacklisted — checks the blacklisted_visitors table in the given DB pool.
 * Supports lookup by visitor_id (if visitor already exists) or by phone.
 */
const isBlacklisted = async (db, visitorId = null, phone = null) => {
  if (!visitorId && !phone) return null;
  let rows;
  if (visitorId) {
    [rows] = await db.query(
      `SELECT bv.id, bv.reason FROM blacklisted_visitors bv WHERE bv.visitor_id = ? AND bv.is_active = TRUE LIMIT 1`,
      [visitorId]
    );
  } else {
    [rows] = await db.query(
      `SELECT bv.id, bv.reason FROM blacklisted_visitors bv
       JOIN visitors v ON v.id = bv.visitor_id
       WHERE v.phone = ? AND bv.is_active = TRUE LIMIT 1`,
      [phone]
    );
  }
  return rows.length > 0 ? rows[0] : null;
};

/**
 * checkScheduleConflict — dual conflict detection.
 * Returns { conflict: false } or
 * { conflict: true, types: ['HOST_BUSY','VISITOR_BUSY'], host_conflict: {...}, visitor_conflict: {...} }
 */
const checkScheduleConflict = async (db, hostUserId, visitDate, startTime, endTime, visitorPhone = null) => {
  const result = { conflict: false, types: [], host_conflict: null, visitor_conflict: null };

  if (!startTime || !endTime) return result;

  // ── 1. Host conflict ──────────────────────────────────────────────────────
  const [hostRows] = await db.query(
    `SELECT vr.id, vr.visit_start_time, vr.visit_end_time,
            COALESCE(vr.visitor_name, v.full_name, 'Unknown Visitor') AS visitor_name
     FROM visit_requests vr
     LEFT JOIN visitors v ON v.id = vr.visitor_id
     WHERE vr.host_user_id = ?
       AND vr.visit_date = ?
       AND vr.status IN ('PENDING','APPROVED','SCHEDULED')
       AND vr.visit_start_time IS NOT NULL
       AND vr.visit_end_time IS NOT NULL
       AND vr.visit_start_time < ?
       AND vr.visit_end_time > ?`,
    [hostUserId, visitDate, endTime, startTime]
  );

  if (hostRows.length > 0) {
    result.conflict = true;
    result.types.push('HOST_BUSY');
    result.host_conflict = {
      clashing_request_id: hostRows[0].id,
      visitor_name:        hostRows[0].visitor_name,
      time_window:         `${hostRows[0].visit_start_time} – ${hostRows[0].visit_end_time}`,
    };
  }

  // ── 2. Visitor conflict (only if phone provided and visitor exists) ────────
  if (visitorPhone) {
    const [visRows] = await db.query('SELECT id FROM visitors WHERE phone = ?', [visitorPhone]);
    if (visRows.length > 0) {
      const visitorId = visRows[0].id;
      const [vConflict] = await db.query(
        `SELECT vr.id, vr.visit_start_time, vr.visit_end_time, d.name AS dept_name
         FROM visit_requests vr
         JOIN departments d ON d.id = vr.department_id
         WHERE vr.visitor_id = ?
           AND vr.visit_date = ?
           AND vr.status IN ('PENDING','APPROVED','SCHEDULED')
           AND vr.visit_start_time IS NOT NULL
           AND vr.visit_end_time IS NOT NULL
           AND vr.visit_start_time < ?
           AND vr.visit_end_time > ?`,
        [visitorId, visitDate, endTime, startTime]
      );
      if (vConflict.length > 0) {
        result.conflict = true;
        result.types.push('VISITOR_BUSY');
        result.visitor_conflict = {
          clashing_request_id: vConflict[0].id,
          dept_name:           vConflict[0].dept_name,
          time_window:         `${vConflict[0].visit_start_time} – ${vConflict[0].visit_end_time}`,
        };
      }
    }
  }

  return result;
};

// ── Visitor Phone Lookup ───────────────────────────────────────────────────────
/**
 * GET /api/visit-requests/lookup-visitor?phone=XXXXXXXXXX&unit_code=HQ
 * Phone-based visitor autofill. Returns existing visitor data or { found: false }.
 */
const lookupVisitorByPhone = async (req, res) => {
  try {
    const { phone, unit_code } = req.query;
    if (!phone) return sendError(res, 'phone query param is required.', 400);

    let db = req.db;

    if (!db && unit_code) {
      const [unitRows] = await centralPool.query(
        `SELECT db_name FROM units WHERE code = ? AND is_active = 1 AND db_status = 'ACTIVE'`,
        [unit_code.toUpperCase().trim()]
      );
      if (unitRows.length === 0) return sendError(res, 'Unit not found.', 404);
      db = getPool(unitRows[0].db_name);
    }

    if (!db) return sendError(res, 'Provide unit_code for unauthenticated requests.', 400);

    const [rows] = await db.query(
      'SELECT id, full_name, email, phone, address, visitor_type FROM visitors WHERE phone = ?',
      [phone.trim()]
    );

    if (rows.length === 0) return sendSuccess(res, { found: false }, 'Visitor not found.');
    return sendSuccess(res, { found: true, visitor: rows[0] }, 'Visitor found.');
  } catch (err) {
    console.error('[VisitRequestController] lookupVisitorByPhone error:', err.message);
    return sendError(res, 'Lookup failed.', 500);
  }
};

// ── createRequest ─────────────────────────────────────────────────────────────
/**
 * POST /api/visit-requests
 *
 * Supported visit_category values:
 *   EMP, VENDOR, PRIOR, SPOT, PERSONAL_VISIT, INTER_UNIT_VISIT, INTER_UNIT_INVITE
 *
 * visitor_phone, visitor_name, visitor_email stored inline — visitor_id stays NULL until check-in.
 */
const createRequest = async (req, res) => {
  try {
    const {
      visit_category,
      visitor_id,
      host_user_id,
      department_id,
      unit_id,
      target_unit_id,
      purpose,
      visit_date,
      visit_start_time,
      visit_end_time,
      accompanying_count = 0,
      companions = [],
      visitor_phone,
      visitor_name,
      visitor_email,
      company_name,
      vendor_email,
      contact_person,
      force_create = false,
    } = req.body;

    const requester_user_id = req.user ? req.user.id : null;
    const typeCode = visit_category;

    if (!typeCode || !purpose || !visit_date) {
      return sendError(res, 'visit_category, purpose, and visit_date are required.', 400);
    }

    const VALID_TYPES = ['EMPLOYEE_VISIT','VENDOR','PRIOR','SPOT','PERSONAL_VISIT','INTER_UNIT_VISIT','INTER_UNIT_INVITE'];
    if (!VALID_TYPES.includes(typeCode)) {
      return sendError(res, `Invalid visit_category: ${typeCode}`, 400);
    }

    // ── Resolve the correct unit DB (db) ──
    const src = (req.body.request_source || 'SELF').toUpperCase();
    let db = req.db;
    if (typeCode === 'EMPLOYEE_VISIT' && src === 'SELF' && target_unit_id) {
      const { centralPool, getPool } = require('../services/dbManager');
      const [unitRows] = await centralPool.query(
        'SELECT db_name FROM units WHERE id = ? AND is_active = 1 AND db_status = "ACTIVE"',
        [parseInt(target_unit_id)]
      );
      if (unitRows.length > 0) {
        db = getPool(unitRows[0].db_name);
      } else {
        return sendError(res, 'Target unit not found or inactive.', 404);
      }
    }

    const conn = await db.getConnection();

    // ── Resolve effective unit & department ───────────────────────────────────
    const effectiveUnitId = unit_id || req.user?.unit_id;
    const effectiveDeptId = (isSuperAdmin(req.user) || isUnitAdmin(req.user))
      ? department_id
      : (req.user?.department_id || department_id);

    if (!effectiveDeptId && !['INTER_UNIT_VISIT', 'EMPLOYEE_VISIT', 'PERSONAL_VISIT'].includes(typeCode)) {
      conn.release();
      return sendError(res, 'department_id is required.', 400);
    }

    // ── Determine status and request_source by type ───────────────────────────
    let request_source, status, effectiveHostId;

    switch (typeCode) {
      case 'EMPLOYEE_VISIT': {
        // request_source comes from the frontend: 'SELF' (visiting) or 'HOST' (hosting)
        const src = (req.body.request_source || 'SELF').toUpperCase();
        request_source  = src === 'HOST' ? 'HOST' : 'SELF';
        status          = src === 'HOST' ? 'APPROVED' : 'PENDING'; // host-creates → auto-approved
        effectiveHostId = src === 'HOST'
          ? req.user.id                // Host = me
          : (host_user_id || null);    // Host = selected employee
        break;
      }
      case 'EMP':
        request_source  = 'HOST';
        status          = 'PENDING';
        effectiveHostId = host_user_id;
        break;
      case 'VENDOR':
        request_source  = 'HOST';
        status          = 'APPROVED';
        effectiveHostId = host_user_id || requester_user_id;
        break;
      case 'PRIOR':
        request_source  = 'SELF';
        status          = 'PENDING';
        effectiveHostId = host_user_id;
        break;
      case 'SPOT':
        request_source  = 'RECEPTION';
        status          = 'PENDING';
        effectiveHostId = host_user_id;
        break;
      case 'PERSONAL_VISIT':
        request_source  = 'SELF';
        status          = 'APPROVED';
        effectiveHostId = requester_user_id;
        break;
      case 'INTER_UNIT_VISIT':
        request_source  = 'SELF';
        status          = 'PENDING';
        effectiveHostId = host_user_id;
        if (!target_unit_id) { conn.release(); return sendError(res, 'target_unit_id is required for INTER_UNIT_VISIT.', 400); }
        break;
      case 'INTER_UNIT_INVITE':
        request_source  = 'HOST';
        status          = 'APPROVED';
        effectiveHostId = requester_user_id;
        if (!target_unit_id) { conn.release(); return sendError(res, 'target_unit_id is required for INTER_UNIT_INVITE.', 400); }
        break;
      default:
        conn.release();
        return sendError(res, `Unhandled visit_category: ${typeCode}`, 400);
    }

    if (!effectiveHostId) {
      conn.release();
      return sendError(res, 'host_user_id is required.', 400);
    }

    // ── Resolve visitor details from visitor_id if provided ──────────────────
    let resolvedVisitorPhone = visitor_phone  || null;
    let resolvedVisitorName  = visitor_name   || null;
    let resolvedVisitorEmail = visitor_email  || null;

    if (visitor_id) {
      const [visRows] = await db.query(
        'SELECT full_name, phone, email FROM visitors WHERE id = ? LIMIT 1',
        [visitor_id]
      );
      if (visRows.length > 0) {
        resolvedVisitorName  = resolvedVisitorName  || visRows[0].full_name || null;
        resolvedVisitorPhone = resolvedVisitorPhone || visRows[0].phone     || null;
        resolvedVisitorEmail = resolvedVisitorEmail || visRows[0].email     || null;
      }
    }

    // visitor_id stays null for phone-based requests — the visitors table is
    // only populated at check-in time, not when a visit request is created.
    const resolvedVisitorId = visitor_id || null;

    // ── Blacklist check by phone ──────────────────────────────────────────────
    if (resolvedVisitorPhone) {
      const blEntry = await isBlacklisted(db, resolvedVisitorId || null, resolvedVisitorPhone);
      if (blEntry) {
        conn.release();
        return sendError(res, `Entry denied. Visitor is blacklisted: ${blEntry.reason}`, 403);
      }
    }

    // ── Dual conflict detection ───────────────────────────────────────────────
    if (!force_create && visit_start_time && visit_end_time) {
      const conflictResult = await checkScheduleConflict(
        db, effectiveHostId, visit_date, visit_start_time, visit_end_time, resolvedVisitorPhone
      );
      if (conflictResult.conflict) {
        conn.release();
        return res.status(409).json({
          success: false,
          message: 'Schedule conflict detected.',
          conflict: true,
          types:            conflictResult.types,
          host_conflict:    conflictResult.host_conflict,
          visitor_conflict: conflictResult.visitor_conflict,
        });
      }
    }

    // ── Insert visit request (visitor_id = NULL — stored inline) ──────────────
    await conn.beginTransaction();

    const [reqResult] = await conn.query(
      `INSERT INTO visit_requests (
         visitor_id, visitor_phone, visitor_name, visitor_email,
         requester_user_id, host_user_id, department_id, unit_id, target_unit_id,
         visit_category, request_source,
         purpose, visit_date, visit_start_time, visit_end_time, accompanying_count,
         status, company_name, vendor_email, force_created,
         created_at, updated_at
       ) VALUES (
         ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         ?, ?,
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?,
         NOW(), NOW()
       )`,
      [
        resolvedVisitorId,
        resolvedVisitorPhone,
        resolvedVisitorName || (typeCode === 'VENDOR' ? (company_name || null) : null),
        resolvedVisitorEmail,
        requester_user_id,
        effectiveHostId,
        effectiveDeptId || null,
        effectiveUnitId,
        target_unit_id || null,
        typeCode,
        request_source,
        purpose,
        visit_date,
        visit_start_time || null,
        visit_end_time   || null,
        accompanying_count,
        status,
        typeCode === 'VENDOR' ? (company_name || null) : null,
        typeCode === 'VENDOR' ? (vendor_email || null) : null,
        force_create ? 1 : 0,
      ]
    );
    const visitRequestId = reqResult.insertId;

    // ── Insert companions ─────────────────────────────────────────────────────
    if (Array.isArray(companions) && companions.length > 0) {
      for (const c of companions) {
        await conn.query(
          `INSERT INTO request_companions (visit_request_id, full_name, id_type, id_number, created_at) VALUES (?, ?, ?, ?, NOW())`,
          [visitRequestId, c.full_name, c.id_type || null, c.id_number || null]
        );
      }
    }

    // ── Insert approval_history for PENDING types ─────────────────────────────
    if (status === 'PENDING') {
      await conn.query(
        `INSERT INTO approval_history (visit_request_id, acted_by_user_id, action, remarks, created_at)
         VALUES (?, ?, 'PENDING', 'Initial Request', NOW())`,
        [visitRequestId, requester_user_id || effectiveHostId]
      );
    }

    await conn.commit();
    conn.release();

    // ── Auto-generate gate pass for APPROVED types ────────────────────────────
    let passResult = null;
    if (status === 'APPROVED') {
      try {
        passResult = await generateGatePass(visitRequestId, requester_user_id, db);
      } catch (passErr) {
        console.error('[VisitRequestController] Gate pass auto-generation failed:', passErr.message);
      }
    }

    // ── Notifications ─────────────────────────────────────────────────────────
    const notify = (opts) => sendNotification({ db, ...opts });
    const timeStr = visit_start_time ? ` at ${visit_start_time}` : '';
    const [hostRows] = await db.query('SELECT full_name, email, phone FROM users WHERE id = ?', [effectiveHostId]);
    const host = hostRows[0] || {};

    if (typeCode === 'EMPLOYEE_VISIT') {
      const isVisiting = request_source === 'SELF';
      if (isVisiting) {
        const myName = req.user?.full_name || resolvedVisitorName || 'A colleague';
        if (host.email) {
          const tmpl = emailService.visitRequestTemplate(myName, host.full_name, visit_date, purpose, '', visit_start_time || null);
          await notify({ visitRequestId, recipientUserId: effectiveHostId, recipientEmail: host.email, type: 'EMAIL', subject: tmpl.subject, message: tmpl.html });
        }
        await notify({ visitRequestId, recipientUserId: effectiveHostId, type: 'DASHBOARD', message: `${myName} wants to visit you on ${visit_date}${timeStr}. Please approve or reject.` });
      } else {
        await notify({ visitRequestId, recipientUserId: requester_user_id, type: 'DASHBOARD', message: `Employee visit for ${resolvedVisitorName || 'colleague'} on ${visit_date}${timeStr} auto-approved. Gate pass generated.` });
      }
    } else if (typeCode === 'EMP') {
      const displayName = resolvedVisitorName || req.user?.full_name || 'A colleague';
      if (host.email) {
        const tmpl = emailService.visitRequestTemplate(displayName, host.full_name, visit_date, purpose, '', visit_start_time || null);
        await notify({ visitRequestId, recipientUserId: effectiveHostId, recipientEmail: host.email, type: 'EMAIL', subject: tmpl.subject, message: tmpl.html });
      }
      await notify({ visitRequestId, recipientUserId: effectiveHostId, type: 'DASHBOARD', message: `New visit request from ${displayName} on ${visit_date}${timeStr}.` });
    } else if (typeCode === 'VENDOR') {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const qrCodeUrl = passResult?.qr_code_path ? `${baseUrl}/${passResult.qr_code_path}` : null;
      if (vendor_email) {
        const tmpl = emailService.visitApprovedTemplate(contact_person || company_name || 'Vendor Team', host.full_name, visit_date, '', passResult?.pass_number || null, qrCodeUrl, visit_start_time || null);
        await notify({ visitRequestId, recipientEmail: vendor_email, type: 'EMAIL', subject: tmpl.subject, message: tmpl.html });
      }
      await notify({ visitRequestId, type: 'DASHBOARD', message: `Vendor visit scheduled: ${company_name || 'Unknown'} on ${visit_date}${timeStr}.` });
    } else if (typeCode === 'PRIOR') {
      const displayName = resolvedVisitorName || 'External visitor';
      if (host.email) {
        const tmpl = emailService.visitRequestTemplate(displayName, host.full_name, visit_date, purpose, '', visit_start_time || null);
        await notify({ visitRequestId, recipientUserId: effectiveHostId, recipientEmail: host.email, type: 'EMAIL', subject: tmpl.subject, message: tmpl.html });
      }
      if (host.phone) {
        await notify({ visitRequestId, recipientUserId: effectiveHostId, recipientPhone: host.phone, type: 'SMS', message: `VMS: ${displayName} requested to visit you on ${visit_date}${timeStr}. Please log in to approve/reject.` });
      }
      await notify({ visitRequestId, recipientUserId: effectiveHostId, type: 'DASHBOARD', message: `Prior-approved visit request from ${displayName} on ${visit_date}${timeStr} awaiting approval.` });
    } else if (typeCode === 'SPOT') {
      await notify({ visitRequestId, recipientUserId: effectiveHostId, type: 'DASHBOARD', message: `URGENT: Walk-in visitor waiting at reception for you. Purpose: ${purpose}` });
    } else if (typeCode === 'PERSONAL_VISIT') {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const qrCodeUrl = passResult?.qr_code_path ? `${baseUrl}/${passResult.qr_code_path}` : null;
      if (resolvedVisitorEmail) {
        const tmpl = emailService.visitApprovedTemplate(resolvedVisitorName || 'Guest', host.full_name, visit_date, '', passResult?.pass_number || null, qrCodeUrl, visit_start_time || null);
        await notify({ visitRequestId, recipientEmail: resolvedVisitorEmail, type: 'EMAIL', subject: tmpl.subject, message: tmpl.html });
      }
      await notify({ visitRequestId, recipientUserId: requester_user_id, type: 'DASHBOARD', message: `Your personal visit request for ${resolvedVisitorName || 'Guest'} on ${visit_date}${timeStr} is auto-approved. Gate pass generated.` });
    } else if (typeCode === 'INTER_UNIT_VISIT') {
      await notify({ visitRequestId, recipientUserId: effectiveHostId, type: 'DASHBOARD', message: `Inter-unit visit request from ${req.user?.full_name || 'a colleague'} on ${visit_date}${timeStr}. Please approve or reject.` });
    } else if (typeCode === 'INTER_UNIT_INVITE') {
      await notify({ visitRequestId, type: 'DASHBOARD', message: `Inter-unit invite created for ${resolvedVisitorName || 'colleague'} on ${visit_date}${timeStr}. Auto-approved.` });
    }

    // ── Audit log ─────────────────────────────────────────────────────────────
    await logAudit({
      db:         db,
      userId:     requester_user_id,
      action:     'CREATE_REQUEST',
      module:     'VISIT_REQUEST',
      recordType: 'VISIT',
      recordId:   visitRequestId,
      newValues:  { typeCode, status, force_create },
      ipAddress:  req.ip,
      userAgent:  req.headers['user-agent'] || null,
    });

    // ── Return created request ────────────────────────────────────────────────
    const [fullRequest] = await db.query(
      `SELECT vr.*, h.full_name AS host_name, h.email AS host_email,
              d.name AS department_name
       FROM visit_requests vr
       JOIN users h ON h.id = vr.host_user_id
       LEFT JOIN departments d ON d.id = vr.department_id
       WHERE vr.id = ?`,
      [visitRequestId]
    );

    return sendSuccess(res, { ...fullRequest[0], gate_pass: passResult }, 'Visit request created successfully.', 201);
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    conn.release();
    console.error('[VisitRequestController] createRequest error:', err.message);
    return sendError(res, 'Failed to create visit request.', 500);
  }
};

// ── getRequest ────────────────────────────────────────────────────────────────
const getRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await req.db.query(
      `SELECT vr.*,
              h.full_name AS host_name, h.email AS host_email, h.phone AS host_phone, h.designation AS host_designation,
              d.name AS department_name,
              gp.pass_number, gp.qr_code_path, gp.status AS gate_pass_status, gp.id AS gate_pass_id
       FROM visit_requests vr
       JOIN users h ON h.id = vr.host_user_id
       LEFT JOIN departments d ON d.id = vr.department_id
       LEFT JOIN gate_passes gp ON gp.visit_request_id = vr.id
       WHERE vr.id = ?`,
      [id]
    );
    if (rows.length === 0) return sendError(res, 'Visit request not found.', 404);

    const request = rows[0];
    const [companions] = await req.db.query(
      'SELECT id, full_name, id_type, id_number FROM request_companions WHERE visit_request_id = ?', [id]
    );
    const [approvalRows] = await req.db.query(
      `SELECT ah.*, u.full_name AS acted_by_name, u.email AS acted_by_email
       FROM approval_history ah
       JOIN users u ON u.id = ah.acted_by_user_id
       WHERE ah.visit_request_id = ?
       ORDER BY ah.created_at ASC`,
      [id]
    );

    let visitorDetails = null;
    if (request.visitor_id) {
      const [vRows] = await req.db.query(
        'SELECT id, full_name, email, phone, address FROM visitors WHERE id = ?', [request.visitor_id]
      );
      visitorDetails = vRows[0] || null;
    }

    return sendSuccess(res, {
      ...request,
      companions,
      approval_history: approvalRows,
      visitor: visitorDetails,
    }, 'Visit request fetched successfully.');
  } catch (err) {
    console.error('[VisitRequestController] getRequest error:', err.message);
    return sendError(res, 'Failed to fetch visit request.', 500);
  }
};

// ── listRequests ──────────────────────────────────────────────────────────────
const listRequests = async (req, res) => {
  try {
    const { status, visit_date, department_id, visitor_phone } = req.query;
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const conditions = [];
    const params     = [];

    // Scope by role
    if (req.user.role_type === 'employee') {
      conditions.push('(vr.host_user_id = ? OR vr.requester_user_id = ?)');
      params.push(req.user.id, req.user.id);

    // unit_admin and super_admin see all (req.db already scoped to their unit)

    if (status)        { conditions.push('vr.status = ?');           params.push(status); }
    if (visit_date)    { conditions.push('vr.visit_date = ?');        params.push(visit_date); }
    if (department_id) { conditions.push('vr.department_id = ?');     params.push(department_id); }
    if (visitor_phone) { conditions.push('vr.visitor_phone LIKE ?');  params.push(`%${visitor_phone}%`); }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows] = await req.db.query(
      `SELECT vr.id, vr.visit_date, vr.visit_start_time, vr.status, vr.request_source,
              vr.purpose, vr.accompanying_count, vr.created_at, vr.visit_category,
              vr.visitor_name, vr.visitor_phone, vr.company_name, vr.force_created,
              h.full_name AS host_name,
              d.name      AS department_name,
              gp.pass_number
       FROM visit_requests vr
       JOIN users h ON h.id = vr.host_user_id
       LEFT JOIN departments d  ON d.id  = vr.department_id
       LEFT JOIN gate_passes gp ON gp.visit_request_id = vr.id
       ${whereClause}
       ORDER BY vr.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await req.db.query(
      `SELECT COUNT(*) AS total FROM visit_requests vr ${whereClause}`, params
    );

    return sendSuccess(res, {
      requests:   rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    }, 'Visit requests fetched successfully.');
  } catch (err) {
    console.error('[VisitRequestController] listRequests error:', err.message);
    return sendError(res, 'Failed to list visit requests.', 500);
  }
};

// ── cancelRequest ─────────────────────────────────────────────────────────────
const cancelRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const [rows] = await req.db.query(
      'SELECT id, status, requester_user_id, host_user_id FROM visit_requests WHERE id = ?', [id]
    );
    if (rows.length === 0) return sendError(res, 'Visit request not found.', 404);

    const request = rows[0];
    if (!['PENDING','APPROVED'].includes(request.status)) {
      return sendError(res, `Cannot cancel a request with status '${request.status}'.`, 400);
    }

    const isAdmin    = isSuperAdmin(user) || isUnitAdmin(user);
    const isInvolved = request.requester_user_id === user.id || request.host_user_id === user.id;
    if (!isAdmin && !isInvolved) {
      return sendError(res, 'You do not have permission to cancel this request.', 403);
    }

    await req.db.query(
      "UPDATE visit_requests SET status = 'CANCELLED', updated_at = NOW() WHERE id = ?", [id]
    );

    await logAudit({
      db:        req.db,
      userId:    user.id,
      action:    'CANCEL_REQUEST',
      module:    'VISIT_REQUEST',
      recordType: 'VISIT',
      recordId:  parseInt(id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    return sendSuccess(res, { id: parseInt(id), status: 'CANCELLED' }, 'Visit request cancelled successfully.');
  } catch (err) {
    console.error('[VisitRequestController] cancelRequest error:', err.message);
    return sendError(res, 'Failed to cancel visit request.', 500);
  }
};

// ── getMyRequests ─────────────────────────────────────────────────────────────
const getMyRequests = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, upcoming, limit = 10, page = 1 } = req.query;
    const parsedLimit  = Math.min(50, parseInt(limit, 10) || 10);
    const parsedOffset = (Math.max(1, parseInt(page, 10) || 1) - 1) * parsedLimit;

    const conditions = ['(vr.host_user_id = ? OR vr.requester_user_id = ?)'];
    const params     = [userId, userId];

    if (status)              { conditions.push('vr.status = ?');             params.push(status); }
    if (upcoming === 'true') { conditions.push('vr.visit_date >= CURDATE()'); }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const order       = upcoming === 'true' ? 'ASC' : 'DESC';

    const [rows] = await req.db.query(
      `SELECT vr.id, vr.visit_date, vr.status, vr.purpose, vr.visit_category,
              vr.visitor_name, vr.visitor_phone, vr.company_name,
              d.name AS department_name
       FROM visit_requests vr
       LEFT JOIN departments d ON d.id = vr.department_id
       ${whereClause}
       ORDER BY vr.visit_date ${order}
       LIMIT ? OFFSET ?`,
      [...params, parsedLimit, parsedOffset]
    );

    const [[{ total }]] = await req.db.query(
      `SELECT COUNT(*) AS total FROM visit_requests vr ${whereClause}`, params
    );

    return sendSuccess(res, {
      requests:   rows,
      pagination: { page: parseInt(page), limit: parsedLimit, total, pages: Math.ceil(total / parsedLimit) },
    }, 'Your visit requests fetched successfully.');
  } catch (err) {
    console.error('[VisitRequestController] getMyRequests error:', err.message);
    return sendError(res, 'Failed to fetch your requests.', 500);
  }
};

// ── createPublicRequest ───────────────────────────────────────────────────────
/**
 * POST /api/visit-requests/public — No auth required.
 * Stores visitor details inline — NO visitor record created here.
 * Requires unit_code to identify the target unit DB.
 */
const createPublicRequest = async (req, res) => {
  let conn = null;
  try {
    const {
      visitor_full_name, visitor_phone, visitor_email,
      host_user_id, department_id,
      unit_code, unit_id,
      purpose, visit_date, visit_start_time, visit_end_time,
      accompanying_count = 0, companions = [],
      company_name,
    } = req.body;

    // ── Map public-facing visit type to internal category ────────────────────
    const PUBLIC_CATEGORY_MAP = { INDIVIDUAL: 'PERSONAL_VISIT', BUSINESS: 'VENDOR' };
    let visit_category = req.body.visit_category || 'INDIVIDUAL';
    visit_category = PUBLIC_CATEGORY_MAP[visit_category] || visit_category;
    // If already an internal value (PERSONAL_VISIT, VENDOR), pass through unchanged

    if (!visitor_full_name || !visitor_phone || !host_user_id || !department_id || !purpose || !visit_date) {
      return sendError(res, 'Missing required fields (visitor_full_name, visitor_phone, host_user_id, department_id, purpose, visit_date).', 400);
    }
    if (!unit_id && !unit_code) {
      return sendError(res, 'unit_id or unit_code is required.', 400);
    }

    // ── Resolve unit DB via unit_id (preferred) or legacy unit_code ─────────
    let unitRows;
    if (unit_id) {
      [unitRows] = await centralPool.query(
        `SELECT id, db_name, name FROM units WHERE id = ? AND is_active = 1 AND db_status = 'ACTIVE'`,
        [parseInt(unit_id)]
      );
    } else {
      [unitRows] = await centralPool.query(
        `SELECT id, db_name, name FROM units WHERE code = ? AND is_active = 1 AND db_status = 'ACTIVE'`,
        [unit_code.toUpperCase().trim()]
      );
    }
    if (!unitRows || unitRows.length === 0) return sendError(res, 'Unit not found.', 404);

    const unit   = unitRows[0];
    const unitDb = getPool(unit.db_name);
    conn = await unitDb.getConnection();

    // Blacklist check by phone
    const blEntry = await isBlacklisted(unitDb, null, visitor_phone);
    if (blEntry) { conn.release(); return sendError(res, `Access denied. Visitor is blacklisted: ${blEntry.reason}`, 403); }

    // Verify host exists
    const [hostRows] = await unitDb.query('SELECT * FROM users WHERE id = ? AND is_active = 1', [host_user_id]);
    if (hostRows.length === 0) { conn.release(); return sendError(res, 'Host not found or inactive.', 404); }
    const host = hostRows[0];

    await conn.beginTransaction();

    // Insert visit request with inline visitor details (no visitor_id)
    const [reqResult] = await conn.query(
      `INSERT INTO visit_requests (
         visitor_id, visitor_phone, visitor_name, visitor_email,
         requester_user_id, host_user_id, department_id, unit_id,
         visit_category, request_source, purpose, visit_date,
         visit_start_time, visit_end_time, accompanying_count,
         company_name, status, created_at, updated_at
       ) VALUES (NULL, ?, ?, ?, NULL, ?, ?, ?, ?, 'SELF', ?, ?,
                 ?, ?, ?, ?, 'PENDING', NOW(), NOW())`,
      [
        visitor_phone, visitor_full_name, visitor_email || null,
        host.id, department_id, unit.id,
        visit_category,
        purpose, visit_date,
        visit_start_time || null, visit_end_time || null, accompanying_count,
        (visit_category === 'VENDOR' ? (company_name || null) : null),
      ]
    );
    const visitRequestId = reqResult.insertId;

    if (Array.isArray(companions) && companions.length > 0) {
      for (const c of companions) {
        await conn.query(
          'INSERT INTO request_companions (visit_request_id, full_name, created_at) VALUES (?, ?, NOW())',
          [visitRequestId, c.full_name]
        );
      }
    }

    await conn.query(
      `INSERT INTO approval_history (visit_request_id, acted_by_user_id, action, remarks, created_at)
       VALUES (?, ?, 'PENDING', 'Public self-registration', NOW())`,
      [visitRequestId, host.id]
    );

    await conn.commit();
    conn.release();

    // Notify host
    const timeStr = visit_start_time ? ` at ${visit_start_time}` : '';
    const tmpl = emailService.visitRequestTemplate(visitor_full_name, host.full_name, visit_date, purpose, unit.name, visit_start_time || null);
    if (host.email) {
      await sendNotification({ db: unitDb, visitRequestId, recipientUserId: host.id, recipientEmail: host.email, type: 'EMAIL', subject: tmpl.subject, message: tmpl.html });
    }
    if (host.phone) {
      await sendNotification({ db: unitDb, visitRequestId, recipientUserId: host.id, recipientPhone: host.phone, type: 'SMS', message: `VMS: ${visitor_full_name} requested to visit you on ${visit_date}${timeStr}. Please approve/reject.` });
    }
    await sendNotification({ db: unitDb, visitRequestId, recipientUserId: host.id, type: 'DASHBOARD', message: `New prior-approved request from ${visitor_full_name} on ${visit_date}${timeStr} awaiting approval.` });

    return sendSuccess(res, { visitRequestId, status: 'PENDING' }, 'Visit request submitted successfully.', 201);
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) {} conn.release(); }
    console.error('[VisitRequestController] createPublicRequest error:', err.message);
    return sendError(res, 'Failed to submit request.', 500);
  }
};

// ── getMyVisitors ─────────────────────────────────────────────────────────────
/**
 * GET /api/visit-requests/my-visitors
 * Returns visitors who checked in to meet the logged-in user (from employee_visitor_log).
 */
const getMyVisitors = async (req, res) => {
  try {
    const { from, to, limit = 20, page = 1 } = req.query;
    const parsedLimit  = Math.min(100, parseInt(limit, 10) || 20);
    const parsedOffset = (Math.max(1, parseInt(page, 10) || 1) - 1) * parsedLimit;

    const conditions = ['evl.host_user_id = ?'];
    const params     = [req.user.id];

    if (from) { conditions.push('DATE(evl.checked_in_at) >= ?'); params.push(from); }
    if (to)   { conditions.push('DATE(evl.checked_in_at) <= ?'); params.push(to); }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const [rows] = await req.db.query(
      `SELECT evl.id, evl.checked_in_at,
              v.full_name AS visitor_name, v.phone AS visitor_phone, v.email AS visitor_email,
              d.name AS department_name,
              vr.visit_category, vr.purpose, vr.visit_date
       FROM employee_visitor_log evl
       JOIN visitors    v  ON v.id  = evl.visitor_id
       JOIN departments d  ON d.id  = evl.department_id
       JOIN visit_requests vr ON vr.id = evl.visit_request_id
       ${whereClause}
       ORDER BY evl.checked_in_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parsedLimit, parsedOffset]
    );

    const [[{ total }]] = await req.db.query(
      `SELECT COUNT(*) AS total FROM employee_visitor_log evl ${whereClause}`, params
    );

    return sendSuccess(res, {
      visitors:   rows,
      pagination: { page: parseInt(page), limit: parsedLimit, total, pages: Math.ceil(total / parsedLimit) },
    }, 'Visitor history fetched successfully.');
  } catch (err) {
    console.error('[VisitRequestController] getMyVisitors error:', err.message);
    return sendError(res, 'Failed to fetch visitor history.', 500);
  }
};

module.exports = {
  createPublicRequest, createRequest, getRequest, listRequests,
  cancelRequest, getMyRequests, lookupVisitorByPhone, getMyVisitors,
};
