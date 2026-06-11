// backend/controllers/visitRequest.controller.js
'use strict';

const jwt = require('jsonwebtoken');
const { centralPool, getPool } = require('../services/dbManager');
const { sendSuccess, sendError } = require('../utils/response.util');
const { sendNotification }       = require('../services/notification.service');
const emailService               = require('../services/email.service');
const { logAudit }               = require('../utils/auditLogger.util');
const { generateGatePass }       = require('../services/gatePass.service');
const { isSuperAdmin, isUnitAdmin } = require('../middlewares/rbac.middleware');
const { emitToUser, emitToUnitSecurity } = require('../socket/socketManager');

// IST date helper (mirrors the one in approval.controller.js)
const getISTDateString = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);

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
 *   EMPLOYEE_VISIT, VENDOR, SPOT, PERSONAL_VISIT
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

    const VALID_TYPES = ['EMPLOYEE_VISIT','VENDOR','SPOT','PERSONAL_VISIT'];
    if (!VALID_TYPES.includes(typeCode)) {
      return sendError(res, `Invalid visit_category: ${typeCode}. Allowed: EMPLOYEE_VISIT, VENDOR, SPOT, PERSONAL_VISIT`, 400);
    }

    // ── Resolve the correct unit DB (db) ──
    const src = (req.body.request_source || 'SELF').toUpperCase();
    let db = req.db;
    let isCrossUnit    = false;  // true when EMPLOYEE_VISIT routes to a different unit's DB
    let crossUnitDbName = null;  // db_name of the target unit (cross-unit only)
    if (typeCode === 'EMPLOYEE_VISIT' && src === 'SELF' && target_unit_id) {
      const { centralPool, getPool } = require('../services/dbManager');
      const [unitRows] = await centralPool.query(
        'SELECT db_name FROM units WHERE id = ? AND is_active = 1 AND db_status = "ACTIVE"',
        [parseInt(target_unit_id)]
      );
      if (unitRows.length > 0) {
        crossUnitDbName = unitRows[0].db_name;
        db = getPool(crossUnitDbName);
        isCrossUnit = true;  // request lives in a DIFFERENT unit's DB
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

    if (!effectiveDeptId && !['EMPLOYEE_VISIT', 'PERSONAL_VISIT'].includes(typeCode)) {
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
      case 'VENDOR':
        request_source  = 'HOST';
        status          = 'APPROVED';
        effectiveHostId = host_user_id || requester_user_id;
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

    // ── Unit-level blacklist check by phone ──────────────────────────────────
    if (resolvedVisitorPhone) {
      const blEntry = await isBlacklisted(db, resolvedVisitorId || null, resolvedVisitorPhone);
      if (blEntry) {
        conn.release();
        return sendError(res, `Entry denied. Visitor is blacklisted: ${blEntry.reason}`, 403);
      }
    }

    // ── Host-level phone blacklist check ─────────────────────────────────────
    if (resolvedVisitorPhone && effectiveHostId) {
      const [hostBlRows] = await db.query(
        `SELECT id, reason FROM host_phone_blacklist
         WHERE host_user_id = ? AND visitor_phone = ? AND is_active = TRUE LIMIT 1`,
        [effectiveHostId, resolvedVisitorPhone]
      );
      if (hostBlRows.length > 0) {
        conn.release();
        return sendError(
          res,
          `The host is currently unavailable for visits from this visitor. Reason: ${hostBlRows[0].reason}`,
          403
        );
      }
    }

    // ── Duplicate request guard ────────────────────────────────────────────────────────────────────────────
    // Prevent duplicate PENDING requests to the same host on the same date.
    // Skip for cross-unit EMPLOYEE_VISIT: the request lives in another unit's DB
    // which is invisible to the requester's own request list — they cannot see or
    // cancel it — so enforcing this guard would permanently block them.
    if (!isCrossUnit && resolvedVisitorPhone && effectiveHostId && visit_date) {
      const [dupRows] = await db.query(
        `SELECT id, status FROM visit_requests
         WHERE visitor_phone = ?
           AND host_user_id  = ?
           AND visit_date    = ?
           AND status = 'PENDING'
         LIMIT 1`,
        [resolvedVisitorPhone, effectiveHostId, visit_date]
      );
      if (dupRows.length > 0) {
        conn.release();
        return res.status(409).json({
          success:    false,
          duplicate:  true,
          existing_request_id: dupRows[0].id,
          existing_status:     dupRows[0].status,
          message:    `A visit request for this visitor to this host on ${visit_date} is already pending approval. Please wait for it to be processed or cancel it before creating a new one.`,
        });
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
    const [hostRows] = await db.query('SELECT full_name, email, phone, unit_id FROM users WHERE id = ?', [effectiveHostId]);
    const host = hostRows[0] || {};

    // ── Socket: notify security gate room for auto-approved visits that are today ─
    if (status === 'APPROVED' && effectiveUnitId) {
      try {
        const todayIST    = getISTDateString();
        const visitDateIST = getISTDateString(new Date(visit_date));
        if (visitDateIST === todayIST) {
          // Fetch department name for the payload
          let deptNameForSocket = null;
          if (effectiveDeptId) {
            try {
              const [deptRows] = await db.query(
                'SELECT name FROM departments WHERE id = ? LIMIT 1',
                [effectiveDeptId]
              );
              deptNameForSocket = deptRows[0]?.name ?? null;
            } catch (_) { /* non-fatal */ }
          }
          emitToUnitSecurity(effectiveUnitId, 'visit:approved:today', {
            id:               visitRequestId,
            visitor_name:     resolvedVisitorName,
            visitor_phone:    resolvedVisitorPhone,
            host_user_id:     effectiveHostId,
            host_name:        host.full_name ?? null,
            department_name:  deptNameForSocket,
            visit_date:       visit_date,
            visit_start_time: visit_start_time || null,
            visit_end_time:   visit_end_time   || null,
            visit_category:   typeCode,
            status:           'APPROVED',
            purpose:          purpose,
            pass_number:      passResult?.pass_number || null,
          });
        }
      } catch (socketErr) {
        console.error('[VisitRequestController] Failed to emit visit:approved:today:', socketErr.message);
      }
    }

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
    } else if (typeCode === 'VENDOR') {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const qrCodeUrl = passResult?.qr_code_path ? `${baseUrl}/${passResult.qr_code_path}` : null;
      if (vendor_email) {
        const tmpl = emailService.visitApprovedTemplate(contact_person || company_name || 'Vendor Team', host.full_name, visit_date, '', passResult?.pass_number || null, qrCodeUrl, visit_start_time || null);
        await notify({ visitRequestId, recipientEmail: vendor_email, type: 'EMAIL', subject: tmpl.subject, message: tmpl.html });
      }
      await notify({ visitRequestId, type: 'DASHBOARD', message: `Vendor visit scheduled: ${company_name || 'Unknown'} on ${visit_date}${timeStr}.` });
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
    }

    // ── Socket: notify host if request is PENDING (needs their approval) ────────────────────────────
    // Use the already-resolved DB name — cross-unit uses crossUnitDbName,
    // same-unit uses req.user.unit_db (mirrors gate.controller check-in approach).
    if (status === 'PENDING' && effectiveHostId) {
      const hostSocketDb = isCrossUnit ? crossUnitDbName : req.user.unit_db;
      if (hostSocketDb) {
        try {
          const { emitToUser: emitFn } = require('../socket/socketManager');
          emitFn(effectiveHostId, hostSocketDb, 'visit:request:new', {
            visit_request_id: visitRequestId,
            visitor_name:     resolvedVisitorName || 'A visitor',
            visitor_phone:    resolvedVisitorPhone || null,
            visit_date:       visit_date,
            visit_start_time: visit_start_time || null,
            visit_category:   typeCode,
            purpose:          purpose,
            created_at:       new Date(),
          });
          console.log(`[VisitRequestController] visit:request:new emitted to host #${effectiveHostId} (db: ${hostSocketDb})`);
        } catch (socketErr) {
          console.error('[VisitRequestController] Failed to emit socket notification:', socketErr.message);
        }
      } else {
        console.warn(`[VisitRequestController] Skipping visit:request:new — could not resolve host socket DB (unit_db=${req.user.unit_db})`);
      }
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

    // ── Check if the requesting user has blocked this visitor's phone ────────
    // Returns block ID if blocked (so frontend can show Unblock instead of Block)
    let hostBlockId = null;
    if (request.visitor_phone && req.user && request.host_user_id) {
      try {
        const [blCheck] = await req.db.query(
          `SELECT id FROM host_phone_blacklist
           WHERE host_user_id = ? AND visitor_phone = ? AND is_active = TRUE LIMIT 1`,
          [request.host_user_id, request.visitor_phone]
        );
        if (blCheck.length > 0) hostBlockId = blCheck[0].id;
      } catch (_) { /* non-fatal — table may not exist on older dbs */ }
    }

    return sendSuccess(res, {
      ...request,
      companions,
      approval_history: approvalRows,
      visitor: visitorDetails,
      host_block_id: hostBlockId,  // null = not blocked, number = block entry ID
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
    const isEmployee = req.user.role_type === 'employee';

    // Scope by role
    if (isEmployee) {
      conditions.push('(vr.host_user_id = ? OR vr.requester_user_id = ?)');
      params.push(req.user.id, req.user.id);
    }

    // unit_admin and super_admin see all (req.db already scoped to their unit)

    if (status)        { conditions.push('vr.status = ?');           params.push(status); }
    if (visit_date)    { conditions.push('vr.visit_date = ?');        params.push(visit_date); }
    if (department_id) { conditions.push('vr.department_id = ?');     params.push(department_id); }
    if (visitor_phone) { conditions.push('vr.visitor_phone LIKE ?');  params.push(`%${visitor_phone}%`); }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const SELECT_COLS = `
      vr.id, vr.visit_date, vr.visit_start_time, vr.status, vr.request_source,
      vr.purpose, vr.accompanying_count, vr.created_at, vr.visit_category,
      vr.visitor_name, vr.visitor_phone, vr.company_name, vr.force_created,
      h.full_name AS host_name,
      d.name      AS department_name,
      gp.pass_number`;

    const [rows] = await req.db.query(
      `SELECT ${SELECT_COLS}
       FROM visit_requests vr
       JOIN users h ON h.id = vr.host_user_id
       LEFT JOIN departments d  ON d.id  = vr.department_id
       LEFT JOIN gate_passes gp ON gp.visit_request_id = vr.id
       ${whereClause}
       ORDER BY vr.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total: ownTotal }]] = await req.db.query(
      `SELECT COUNT(*) AS total FROM visit_requests vr ${whereClause}`, params
    );

    // ── Cross-unit fan-out for employees ────────────────────────────────────────────────
    // When an employee visits someone in another unit, the request is stored in
    // that unit's DB (not theirs). Fan out to make those requests visible here.
    let crossUnitRows = [];
    if (isEmployee) {
      try {
        const { centralPool, getPool } = require('../services/dbManager');
        const [activeUnits] = await centralPool.query(
          `SELECT u.db_name FROM units u
           JOIN units myUnit ON myUnit.id = ?
           WHERE u.is_active = 1 AND u.db_status = 'ACTIVE' AND u.db_name != myUnit.db_name`,
          [req.user.unit_id]
        );
        await Promise.all(activeUnits.map(async (unit) => {
          try {
            const otherDb  = getPool(unit.db_name);
            const xConds   = [`vr.requester_user_id = ?`, `vr.visit_category = 'EMPLOYEE_VISIT'`];
            const xParams  = [req.user.id];
            if (status)     { xConds.push('vr.status = ?');     xParams.push(status); }
            if (visit_date) { xConds.push('vr.visit_date = ?'); xParams.push(visit_date); }
            const [xRows] = await otherDb.query(
              `SELECT ${SELECT_COLS}
               FROM visit_requests vr
               JOIN users h ON h.id = vr.host_user_id
               LEFT JOIN departments d  ON d.id  = vr.department_id
               LEFT JOIN gate_passes gp ON gp.visit_request_id = vr.id
               WHERE ${xConds.join(' AND ')}
               ORDER BY vr.created_at DESC LIMIT 50`,
              xParams
            );
            crossUnitRows.push(...xRows.map(r => ({ ...r, _cross_unit_db: unit.db_name })));
          } catch { /* unit DB unreachable — skip silently */ }
        }));
      } catch { /* fan-out error — non-fatal */ }
    }

    const allRows  = [...rows, ...crossUnitRows].sort((a, b) =>
      new Date(b.created_at) - new Date(a.created_at)
    );
    const total    = Number(ownTotal) + crossUnitRows.length;
    const pageRows = allRows.slice(0, limit);

    return sendSuccess(res, {
      requests:   pageRows,
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

    // Try own unit DB first; if not found, fan out to other unit DBs
    // (needed for cross-unit EMPLOYEE_VISIT stored in the target unit's DB)
    let targetDb = req.db;
    let [rows]   = await req.db.query(
      'SELECT id, status, requester_user_id, host_user_id FROM visit_requests WHERE id = ?', [id]
    );

    if (rows.length === 0) {
      try {
        const { centralPool, getPool } = require('../services/dbManager');
        const [activeUnits] = await centralPool.query(
          `SELECT u.db_name FROM units u
           JOIN units myUnit ON myUnit.id = ?
           WHERE u.is_active = 1 AND u.db_status = 'ACTIVE' AND u.db_name != myUnit.db_name`,
          [req.user.unit_id]
        );
        for (const unit of activeUnits) {
          try {
            const otherDb = getPool(unit.db_name);
            const [xRows] = await otherDb.query(
              'SELECT id, status, requester_user_id, host_user_id FROM visit_requests WHERE id = ?', [id]
            );
            if (xRows.length > 0) { rows = xRows; targetDb = otherDb; break; }
          } catch { /* skip unreachable DBs */ }
        }
      } catch { /* fan-out failed — fall through to 404 */ }
    }

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

    await targetDb.query(
      "UPDATE visit_requests SET status = 'CANCELLED', updated_at = NOW() WHERE id = ?", [id]
    );

    await logAudit({
      db:        targetDb,
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
    // ── Decode X-Visitor-Token to populate visitor identity details ──────────
    const token = req.headers['x-visitor-token'];
    let tokenData = {};
    if (token) {
      try {
        tokenData = jwt.verify(token, process.env.JWT_SECRET);
      } catch (jwtErr) {
        console.error('[VisitRequestController] Public request JWT verification failed:', jwtErr.message);
        return sendError(res, 'Session expired or invalid visitor verification token. Please verify your OTP again.', 401);
      }
    }

    const {
      visitor_full_name: bodyName,
      visitor_phone: bodyPhone,
      visitor_email: bodyEmail,
      host_user_id,
      department_id,
      unit_code,
      unit_id,
      purpose,
      visit_date,
      visit_start_time,
      visit_end_time,
      accompanying_count = 0,
      companions = [],
      company_name,
    } = req.body;

    const visitor_full_name = (bodyName || tokenData.visitor_name || '').trim();
    const visitor_phone = (bodyPhone || tokenData.visitor_phone || '').trim();
    const visitor_email = (bodyEmail || tokenData.visitor_email || '').trim();

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

    // ── Blacklist check by phone (unit-level) ────────────────────────────────
    const blEntry = await isBlacklisted(unitDb, null, visitor_phone);
    if (blEntry) { conn.release(); return sendError(res, `Access denied. Visitor is blacklisted: ${blEntry.reason}`, 403); }

    // ── Host-level phone blacklist check ─────────────────────────────────────
    const [hostBlRows] = await unitDb.query(
      `SELECT id, reason FROM host_phone_blacklist
       WHERE host_user_id = ? AND visitor_phone = ? AND is_active = TRUE LIMIT 1`,
      [host_user_id, visitor_phone]
    );
    if (hostBlRows.length > 0) {
      conn.release();
      return sendError(
        res,
        `The host is currently unavailable for visits from this visitor. Reason: ${hostBlRows[0].reason}`,
        403
      );
    }

    // ── Duplicate request guard ───────────────────────────────────────────────
    const [dupRows] = await unitDb.query(
      `SELECT id, status FROM visit_requests
       WHERE visitor_phone = ?
         AND host_user_id  = ?
         AND visit_date    = ?
         AND status IN ('PENDING', 'APPROVED')
       LIMIT 1`,
      [visitor_phone, host_user_id, visit_date]
    );
    if (dupRows.length > 0) {
      conn.release();
      return res.status(409).json({
        success:    false,
        duplicate:  true,
        existing_request_id: dupRows[0].id,
        message:    `A request for this date is already ${dupRows[0].status.toLowerCase()}. You cannot submit another one.`,
      });
    }

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

    // Emit socket notification to host
    try {
      emitToUser(host.id, unit.db_name, 'visit:request:new', {
        visit_request_id: visitRequestId,
        visitor_name:     visitor_full_name,
        visitor_phone:    visitor_phone || null,
        visit_date:       visit_date,
        visit_start_time: visit_start_time || null,
        visit_category:   visit_category,
        purpose:          purpose,
        created_at:       new Date(),
      });
    } catch (socketErr) {
      console.error('[VisitRequestController] Failed to emit socket notification for public request:', socketErr.message);
    }

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

// ── blacklistVisitorFromRequest ───────────────────────────────────────────────
/**
 * POST /api/visit-requests/:id/blacklist-visitor
 * Allows the host (or admin) of a visit request to add the visitor's phone
 * to their personal host_phone_blacklist so all future requests from that
 * visitor to this host are automatically rejected.
 */
const blacklistVisitorFromRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return sendError(res, 'A reason is required to block this visitor.', 400);
    }

    // Fetch the visit request
    const [rows] = await req.db.query(
      'SELECT id, host_user_id, visitor_phone, visitor_name FROM visit_requests WHERE id = ? LIMIT 1',
      [id]
    );
    if (!rows.length) return sendError(res, 'Visit request not found.', 404);
    const vr = rows[0];

    // Only the host or an admin can blacklist
    const isAdmin = ['super_admin', 'unit_admin'].includes(req.user.role_type);
    const isHost  = String(vr.host_user_id) === String(req.user.id);
    if (!isAdmin && !isHost) {
      return sendError(res, 'Only the host or an administrator can block this visitor.', 403);
    }

    if (!vr.visitor_phone) {
      return sendError(res, 'No phone number on record for this visitor — cannot block.', 400);
    }

    // Check if already blocked by this host
    const [existing] = await req.db.query(
      'SELECT id FROM host_phone_blacklist WHERE host_user_id = ? AND visitor_phone = ? AND is_active = TRUE LIMIT 1',
      [vr.host_user_id, vr.visitor_phone]
    );
    if (existing.length > 0) {
      return sendError(res, 'This visitor is already blocked by this host.', 409);
    }

    await req.db.query(
      `INSERT INTO host_phone_blacklist
         (host_user_id, visitor_phone, visitor_name, reason, blocked_by, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, TRUE, NOW())`,
      [vr.host_user_id, vr.visitor_phone, vr.visitor_name || null, reason.trim(), req.user.id]
    );

    return sendSuccess(res, null, 'Visitor blocked successfully. Future requests from this visitor will be automatically declined.');
  } catch (err) {
    console.error('[VisitRequestController] blacklistVisitorFromRequest error:', err.message);
    return sendError(res, 'Failed to block visitor.', 500);
  }
};

// ── getHostBlacklist ──────────────────────────────────────────────────────────
/**
 * GET /api/visit-requests/my-blocked-visitors
 * Returns the host's personal phone blacklist.
 */
const getHostBlacklist = async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT id, visitor_phone, visitor_name, reason, created_at
       FROM host_phone_blacklist
       WHERE host_user_id = ? AND is_active = TRUE
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    return sendSuccess(res, rows, 'Blocked visitors fetched.');
  } catch (err) {
    console.error('[VisitRequestController] getHostBlacklist error:', err.message);
    return sendError(res, 'Failed to fetch blocked visitors.', 500);
  }
};

// ── unblockVisitor ────────────────────────────────────────────────────────────
/**
 * DELETE /api/visit-requests/blocked-visitors/:blockId
 * Removes an entry from the host's personal phone blacklist.
 */
const unblockVisitor = async (req, res) => {
  try {
    const { blockId } = req.params;
    const isAdmin = ['super_admin', 'unit_admin'].includes(req.user.role_type);
    const whereExtra = isAdmin ? '' : 'AND host_user_id = ?';
    const params = isAdmin ? [blockId] : [blockId, req.user.id];

    const [result] = await req.db.query(
      `UPDATE host_phone_blacklist SET is_active = FALSE WHERE id = ? ${whereExtra} AND is_active = TRUE`,
      params
    );
    if (result.affectedRows === 0) return sendError(res, 'Block entry not found or already removed.', 404);
    return sendSuccess(res, null, 'Visitor unblocked successfully.');
  } catch (err) {
    console.error('[VisitRequestController] unblockVisitor error:', err.message);
    return sendError(res, 'Failed to unblock visitor.', 500);
  }
};

module.exports = {
  createPublicRequest, createRequest, getRequest, listRequests,
  cancelRequest, getMyRequests, lookupVisitorByPhone, getMyVisitors,
  blacklistVisitorFromRequest, getHostBlacklist, unblockVisitor,
};
