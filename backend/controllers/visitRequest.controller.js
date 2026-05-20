// backend/controllers/visitRequest.controller.js
'use strict';

const pool = require('../db');
const { sendSuccess, sendError } = require('../utils/response.util');
const { sendNotification } = require('../services/notification.service');
const emailService = require('../services/email.service');
const { logAudit } = require('../utils/auditLogger.util');
const { generateGatePass } = require('../services/gatePass.service');
const { isOrgAdmin } = require('../middlewares/rbac.middleware');

const isBlacklisted = async (conn, visitorId = null, phone = null) => {
  if (!visitorId && !phone) return null;
  let rows;
  if (visitorId) {
    [rows] = await conn.query(`SELECT bv.id, bv.reason FROM blacklisted_visitors bv WHERE bv.visitor_id = ? AND bv.is_active = TRUE LIMIT 1`, [visitorId]);
  } else {
    [rows] = await conn.query(`SELECT bv.id, bv.reason FROM blacklisted_visitors bv JOIN visitors v ON v.id = bv.visitor_id WHERE v.phone = ? AND bv.is_active = TRUE LIMIT 1`, [phone]);
  }
  return rows.length > 0 ? rows[0] : null;
};

// ── createRequest ─────────────────────────────────────────────────────────────
const createRequest = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const {
      visit_category, host_user_id, department_id, organization_id,
      purpose, visit_date, visit_start_time, visit_end_time, accompanying_count = 0,
      company_name, vendor_email, contact_person, gst_number, work_order_ref, service_type,
      visitor_id, companions = []
    } = req.body;

    const requester_user_id = req.user ? req.user.id : null;
    const typeCode = visit_category;

    // Department scoping: non-org-admin users are locked to their own department
    const effectiveDeptId = isOrgAdmin(req.user)
      ? (department_id || null)
      : req.user.department_id;
    const effectiveOrgId = organization_id || req.user.organization_id;

    if (!effectiveDeptId) {
      conn.release();
      return sendError(res, 'department_id is required.', 400);
    }

    if (visitor_id) {
      const blEntry = await isBlacklisted(conn, visitor_id, null);
      if (blEntry) {
        conn.release();
        return sendError(res, 'This visitor is blacklisted and cannot be admitted.', 403);
      }
    }

    let request_source, status;
    if (typeCode === 'EMP')    { request_source = 'HOST';      status = 'PENDING'; }
    else if (typeCode === 'VENDOR') { request_source = 'HOST'; status = 'APPROVED'; }
    else if (typeCode === 'PRIOR')  { request_source = 'SELF'; status = 'PENDING'; }
    else if (typeCode === 'SPOT')   { request_source = 'RECEPTION'; status = 'PENDING'; }
    else { conn.release(); return sendError(res, `Unknown visitor type code: ${typeCode}`, 400); }

    await conn.beginTransaction();

    const [reqResult] = await conn.query(
      `INSERT INTO visit_requests (visitor_id, requester_user_id, host_user_id, department_id, organization_id, visit_category, request_source, purpose, visit_date, visit_start_time, visit_end_time, accompanying_count, status, company_name, vendor_email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [visitor_id || null, requester_user_id, host_user_id, effectiveDeptId, effectiveOrgId, visit_category, request_source, purpose, visit_date, visit_start_time || null, visit_end_time || null, accompanying_count, status, typeCode === 'VENDOR' ? (company_name || null) : null, typeCode === 'VENDOR' ? (vendor_email || null) : null]
    );
    const visitRequestId = reqResult.insertId;

    if (Array.isArray(companions) && companions.length > 0) {
      for (const c of companions) {
        await conn.query(`INSERT INTO request_companions (visit_request_id, full_name, id_type, id_number, created_at) VALUES (?, ?, ?, ?, NOW())`, [visitRequestId, c.full_name, c.id_type || null, c.id_number || null]);
      }
    }

    if (['EMP', 'PRIOR', 'SPOT'].includes(typeCode)) {
      await conn.query(`INSERT INTO approval_history (organization_id, visit_request_id, acted_by_user_id, action, remarks, created_at) VALUES (?, ?, ?, 'PENDING', 'Initial Request', NOW())`, [effectiveOrgId, visitRequestId, requester_user_id || host_user_id]);
    }

    await conn.commit();
    conn.release();

    const [hostRows] = await pool.query(`SELECT u.full_name, u.email, u.phone, o.name AS org_name FROM users u JOIN organizations o ON o.id = u.organization_id WHERE u.id = ?`, [host_user_id]);
    const host = hostRows[0] || {};
    let visitor = null;
    if (visitor_id) {
      const [vRows] = await pool.query(`SELECT full_name, email, phone FROM visitors WHERE id = ?`, [visitor_id]);
      visitor = vRows[0] || null;
    }

    const timeStr = visit_start_time ? ` at ${visit_start_time}` : '';

    if (typeCode === 'EMP') {
      const visitorName = visitor ? visitor.full_name : (req.user ? req.user.full_name : 'A colleague');
      const tmpl = emailService.visitRequestTemplate(visitorName, host.full_name, visit_date, purpose, host.org_name || '', visit_start_time || null);
      if (host.email) await sendNotification({ visitRequestId, recipientUserId: host_user_id, recipientEmail: host.email, type: 'EMAIL', subject: tmpl.subject, message: tmpl.html });
      await sendNotification({ visitRequestId, recipientUserId: host_user_id, type: 'DASHBOARD', message: `New visit request from ${visitorName} on ${visit_date}${timeStr}.` });
    } else if (typeCode === 'VENDOR') {
      let passResult = null;
      try {
        passResult = await generateGatePass(visitRequestId, requester_user_id || host_user_id);
      } catch (passErr) {
        console.error('Vendor gate pass auto-generation failed:', passErr.message);
      }
      await sendNotification({ visitRequestId, type: 'DASHBOARD', message: `Vendor visit scheduled: ${company_name || 'Unknown Company'} on ${visit_date}${timeStr}.` });
      if (vendor_email) {
        const baseUrl = req ? `${req.protocol}://${req.get('host')}` : `http://localhost:${process.env.PORT || 5000}`;
        const qrCodeUrl = passResult?.qr_code_path ? `${baseUrl}/${passResult.qr_code_path}` : null;
        const tmpl = emailService.visitApprovedTemplate(
          contact_person || company_name || 'Vendor Team',
          host.full_name, visit_date, host.org_name || '',
          passResult?.pass_number || null, qrCodeUrl, visit_start_time || null
        );
        await sendNotification({ visitRequestId, recipientEmail: vendor_email, type: 'EMAIL', subject: tmpl.subject, message: tmpl.html });
      }
    } else if (typeCode === 'PRIOR') {
      const visitorName = visitor ? visitor.full_name : 'External visitor';
      const tmpl = emailService.visitRequestTemplate(visitorName, host.full_name, visit_date, purpose, host.org_name || '', visit_start_time || null);
      if (host.email) await sendNotification({ visitRequestId, recipientUserId: host_user_id, recipientEmail: host.email, type: 'EMAIL', subject: tmpl.subject, message: tmpl.html });
      if (host.phone) await sendNotification({ visitRequestId, recipientUserId: host_user_id, recipientPhone: host.phone, type: 'SMS', message: `VMS: ${visitorName} has requested to visit you on ${visit_date}${timeStr}. Please log in to approve/reject.` });
      await sendNotification({ visitRequestId, recipientUserId: host_user_id, type: 'DASHBOARD', message: `Prior-approved visit request from ${visitorName} on ${visit_date}${timeStr} awaiting approval.` });
    } else if (typeCode === 'SPOT') {
      const creatorName = req.user ? req.user.full_name : 'Reception';
      await sendNotification({ visitRequestId, recipientUserId: host_user_id, type: 'DASHBOARD', message: `URGENT: Walk-in visitor waiting at reception for you. Logged by ${creatorName} on ${visit_date}${timeStr}. Purpose: ${purpose}` });
    }

    const [fullRequest] = await pool.query(
      `SELECT vr.*, vr.visit_category AS visitor_type_code, h.full_name AS host_name, h.email AS host_email, d.name AS department_name, o.name AS organization_name FROM visit_requests vr JOIN users h ON h.id = vr.host_user_id JOIN departments d ON d.id = vr.department_id JOIN organizations o ON o.id = vr.organization_id WHERE vr.id = ?`,
      [visitRequestId]
    );

    await logAudit({ userId: requester_user_id, action: 'CREATE_REQUEST', module: 'VISIT_REQUEST', recordType: 'VISIT', recordId: visitRequestId, newValues: { typeCode, status } });
    return sendSuccess(res, fullRequest[0], 'Visit request created successfully.', 201);
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
    const [rows] = await pool.query(
      `SELECT vr.*, vr.visit_category AS visitor_type_code,
              h.full_name AS host_name, h.email AS host_email, h.phone AS host_phone, h.designation AS host_designation,
              d.name AS department_name, o.name AS organization_name,
              vis.full_name AS visitor_name, vis.email AS visitor_email, vis.phone AS visitor_phone,
              req_user.full_name AS requester_name,
              gp.pass_number, gp.qr_code_path, gp.status AS gate_pass_status, gp.id AS gate_pass_id
       FROM visit_requests vr
       JOIN users h ON h.id = vr.host_user_id
       JOIN departments d ON d.id = vr.department_id
       JOIN organizations o ON o.id = vr.organization_id
       LEFT JOIN visitors vis ON vis.id = vr.visitor_id
       LEFT JOIN users req_user ON req_user.id = vr.requester_user_id
       LEFT JOIN gate_passes gp ON gp.visit_request_id = vr.id
       WHERE vr.id = ?`,
      [id]
    );
    if (rows.length === 0) return sendError(res, 'Visit request not found.', 404);
    const request = rows[0];
    const [companions] = await pool.query(`SELECT id, full_name, id_type, id_number FROM request_companions WHERE visit_request_id = ?`, [id]);
    let vendorDetails = [];
    if (request.visitor_id) {
      [vendorDetails] = await pool.query(`SELECT * FROM business_visitor_details WHERE visitor_id = ?`, [request.visitor_id]);
    }
    const [approvalRows] = await pool.query(`SELECT ah.*, u.full_name AS acted_by_name, u.email AS acted_by_email FROM approval_history ah JOIN users u ON u.id = ah.acted_by_user_id WHERE ah.visit_request_id = ? ORDER BY ah.created_at ASC`, [id]);
    return sendSuccess(res, { ...request, companions, vendor_details: request.visitor_id ? vendorDetails[0] || null : null, approval_history: approvalRows }, 'Visit request fetched successfully.');
  } catch (err) {
    console.error('[VisitRequestController] getRequest error:', err.message);
    return sendError(res, 'Failed to fetch visit request.', 500);
  }
};

// ── listRequests ──────────────────────────────────────────────────────────────
const listRequests = async (req, res) => {
  try {
    const { status, visit_date, department_id, visitor_id } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const conditions = ["h.role_type IN ('employee','dept_admin','org_admin')"];
    const params = [];

    if (req.user.role_type === 'employee') {
      conditions.push('(vr.host_user_id = ? OR vr.requester_user_id = ?)');
      params.push(req.user.id, req.user.id);
    } else if (!isOrgAdmin(req.user)) {
      conditions.push('vr.department_id = ?');
      params.push(req.user.department_id);
    }

    if (status)     { conditions.push('vr.status = ?');     params.push(status); }
    if (visit_date) { conditions.push('vr.visit_date = ?'); params.push(visit_date); }
    if (department_id && isOrgAdmin(req.user)) {
      conditions.push('vr.department_id = ?');
      params.push(department_id);
    }
    if (visitor_id) { conditions.push('vr.visitor_id = ?'); params.push(visitor_id); }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows] = await pool.query(
      `SELECT vr.id, vr.visit_date, vr.visit_start_time, vr.status, vr.request_source, vr.purpose, vr.accompanying_count, vr.created_at,
              vr.visit_category AS visitor_type_code,
              h.full_name AS host_name, d.name AS department_name, o.name AS organization_name,
              CASE WHEN vr.visit_category = 'VENDOR' THEN COALESCE(vr.company_name, 'Unknown Vendor') ELSE COALESCE(vis.full_name, ru.full_name) END AS visitor_name,
              COALESCE(vis.phone, ru.phone) AS visitor_phone,
              ru.full_name AS requester_name,
              gp.pass_number
       FROM visit_requests vr
       JOIN users h ON h.id = vr.host_user_id
       JOIN departments d ON d.id = vr.department_id
       JOIN organizations o ON o.id = vr.organization_id
       LEFT JOIN visitors vis ON vis.id = vr.visitor_id
       LEFT JOIN users ru ON ru.id = vr.requester_user_id
       LEFT JOIN gate_passes gp ON gp.visit_request_id = vr.id
       ${whereClause}
       ORDER BY vr.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM visit_requests vr JOIN users h ON h.id = vr.host_user_id ${whereClause}`, params);
    return sendSuccess(res, { requests: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }, 'Visit requests fetched successfully.');
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
    const [rows] = await pool.query(`SELECT id, status, requester_user_id FROM visit_requests WHERE id = ?`, [id]);
    if (rows.length === 0) return sendError(res, 'Visit request not found.', 404);
    const request = rows[0];
    if (!['PENDING', 'APPROVED'].includes(request.status)) return sendError(res, `Cannot cancel a request with status '${request.status}'.`, 400);

    const isAdmin = isOrgAdmin(user);
    const isRequester = request.requester_user_id === user.id;
    if (!isAdmin && !isRequester) return sendError(res, 'You do not have permission to cancel this request.', 403);

    await pool.query(`UPDATE visit_requests SET status = 'CANCELLED', updated_at = NOW() WHERE id = ?`, [id]);
    await logAudit({ userId: user.id, action: 'CANCEL_REQUEST', module: 'VISIT_REQUEST', recordType: 'VISIT', recordId: id });
    return sendSuccess(res, { id, status: 'CANCELLED' }, 'Visit request cancelled successfully.');
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

    if (status)              { conditions.push('vr.status = ?');           params.push(status); }
    if (upcoming === 'true') { conditions.push('vr.visit_date >= CURDATE()'); }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const order       = upcoming === 'true' ? 'ASC' : 'DESC';

    const [rows] = await pool.query(
      `SELECT vr.id, vr.visit_date, vr.status, vr.purpose, vr.visit_category AS visitor_type_code,
              CASE WHEN vr.visit_category = 'VENDOR' THEN COALESCE(vr.company_name, 'Unknown Vendor') ELSE COALESCE(vis.full_name, ru.full_name) END AS visitor_name,
              d.name AS department_name
       FROM visit_requests vr
       JOIN departments d ON d.id = vr.department_id
       LEFT JOIN visitors vis ON vis.id = vr.visitor_id
       LEFT JOIN users ru ON ru.id = vr.requester_user_id
       ${whereClause}
       ORDER BY vr.visit_date ${order}
       LIMIT ? OFFSET ?`,
      [...params, parsedLimit, parsedOffset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM visit_requests vr ${whereClause}`,
      params
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
// POST /api/visit-requests/public — No auth, for external visitor self-registration
const createPublicRequest = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const {
      visitor_full_name, visitor_phone, visitor_email, company_name,
      host_user_id, department_id, organization_id,
      purpose, visit_date, visit_start_time, visit_end_time,
      id_type, id_number,
      accompanying_count = 0, companions = []
    } = req.body;

    if (!visitor_full_name || !visitor_phone || !host_user_id || !department_id || !organization_id || !purpose || !visit_date) {
      conn.release();
      return sendError(res, 'Missing required fields', 400);
    }

    const blEntry = await isBlacklisted(conn, null, visitor_phone);
    if (blEntry) {
      conn.release();
      return sendError(res, 'Access denied. This visitor is blacklisted.', 403);
    }

    const [hostRows] = await conn.query('SELECT * FROM users WHERE id = ? AND is_active = 1', [host_user_id]);
    if (hostRows.length === 0) {
      conn.release();
      return sendError(res, 'Host not found or inactive', 404);
    }
    const host = hostRows[0];

    await conn.beginTransaction();

    // Upsert visitor
    let visitor_id;
    const [vRows] = await conn.query('SELECT id FROM visitors WHERE phone = ?', [visitor_phone]);
    if (vRows.length > 0) {
      visitor_id = vRows[0].id;
    } else {
      const [vRes] = await conn.query(
        'INSERT INTO visitors (full_name, phone, email, visitor_type, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
        [visitor_full_name, visitor_phone, visitor_email || null, company_name ? 'business' : 'individual']
      );
      visitor_id = vRes.insertId;
    }

    // Store ID proof if provided (INSERT IGNORE skips if already exists for this visitor+type)
    if (id_type && id_number) {
      await conn.query(
        `INSERT IGNORE INTO visitor_documents (visitor_id, id_type, id_number, is_primary, created_at) VALUES (?, ?, ?, TRUE, NOW())`,
        [visitor_id, id_type, id_number]
      );
    }

    const [reqResult] = await conn.query(
      `INSERT INTO visit_requests
       (visitor_id, host_user_id, department_id, organization_id, visit_category, request_source, purpose, visit_date, visit_start_time, visit_end_time, accompanying_count, status, company_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'PRIOR', 'SELF', ?, ?, ?, ?, ?, 'PENDING', ?, NOW(), NOW())`,
      [visitor_id, host.id, department_id, organization_id, purpose, visit_date, visit_start_time || null, visit_end_time || null, accompanying_count, company_name || null]
    );
    const visitRequestId = reqResult.insertId;

    if (Array.isArray(companions) && companions.length > 0) {
      for (const c of companions) {
        await conn.query(`INSERT INTO request_companions (visit_request_id, full_name, created_at) VALUES (?, ?, NOW())`, [visitRequestId, c.full_name]);
      }
    }

    await conn.query(
      `INSERT INTO approval_history (organization_id, visit_request_id, acted_by_user_id, action, remarks, created_at) VALUES (?, ?, ?, 'PENDING', 'Public self-registration', NOW())`,
      [organization_id, visitRequestId, host.id]
    );

    await conn.commit();
    conn.release();

    // Notify Host
    const timeStr = visit_start_time ? ` at ${visit_start_time}` : '';
    const [orgRows] = await pool.query('SELECT name FROM organizations WHERE id = ?', [organization_id]);
    const orgName = orgRows[0]?.name || '';
    const tmpl = emailService.visitRequestTemplate(visitor_full_name, host.full_name, visit_date, purpose, orgName, visit_start_time || null);
    if (host.email) await sendNotification({ visitRequestId, recipientUserId: host.id, recipientEmail: host.email, type: 'EMAIL', subject: tmpl.subject, message: tmpl.html });
    if (host.phone) await sendNotification({ visitRequestId, recipientUserId: host.id, recipientPhone: host.phone, type: 'SMS', message: `VMS: ${visitor_full_name} requested to visit you on ${visit_date}${timeStr}. Please log in to approve/reject.` });
    await sendNotification({ visitRequestId, recipientUserId: host.id, type: 'DASHBOARD', message: `New prior-approved request from ${visitor_full_name} on ${visit_date}${timeStr} awaiting approval.` });

    return sendSuccess(res, { visitRequestId, status: 'PENDING' }, 'Visit request submitted successfully.', 201);
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    conn.release();
    console.error('[VisitRequestController] createPublicRequest error:', err.message);
    return sendError(res, 'Failed to submit request.', 500);
  }
};

module.exports = {
  createPublicRequest, createRequest, getRequest, listRequests, cancelRequest, getMyRequests
};
