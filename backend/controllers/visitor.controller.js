// backend/controllers/visitor.controller.js
'use strict';

const { sendSuccess, sendError } = require('../utils/response.util');
const { isSuperAdmin, isUnitAdmin } = require('../middlewares/rbac.middleware');

// ── createVisitor ─────────────────────────────────────────────────────────────
/**
 * POST /api/visitors
 * Manually create a visitor record in the unit DB.
 * Body: { full_name, phone, email?, address?, id_type?, id_number? }
 */
const createVisitor = async (req, res) => {
  const conn = await req.db.getConnection();
  try {
    const { full_name, phone, email, address, id_type, id_number } = req.body;

    if (!full_name || !phone) {
      conn.release();
      return sendError(res, 'full_name and phone are required.', 400);
    }

    // Check for duplicate phone
    const [existing] = await conn.query(
      `SELECT v.id, v.full_name, vd.id_type, vd.id_number
       FROM visitors v
       LEFT JOIN visitor_documents vd ON vd.visitor_id = v.id AND vd.is_primary = TRUE
       WHERE v.phone = ? LIMIT 1`,
      [phone]
    );

    if (existing.length > 0) {
      conn.release();
      return sendError(res, 'A visitor with this phone number already exists.', 409);
    }

    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO visitors (full_name, email, phone, address, created_at, updated_at)
       VALUES (?, ?, ?, ?, NOW(), NOW())`,
      [full_name, email || null, phone, address || null]
    );
    const visitorId = result.insertId;

    if (id_type && id_number) {
      await conn.query(
        `INSERT INTO visitor_documents (visitor_id, id_type, id_number, is_primary, created_at)
         VALUES (?, ?, ?, TRUE, NOW())`,
        [visitorId, id_type, id_number]
      );
    }

    await conn.commit();

    const [newVisitor] = await conn.query(
      `SELECT v.*, vd.id_type, vd.id_number, vd.is_primary
       FROM visitors v
       LEFT JOIN visitor_documents vd ON vd.visitor_id = v.id AND vd.is_primary = TRUE
       WHERE v.id = ?`,
      [visitorId]
    );

    conn.release();
    return sendSuccess(res, newVisitor[0], 'Visitor created successfully.', 201);
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    conn.release();
    console.error('[VisitorController] createVisitor error:', err.message);
    if (err.code === 'ER_DUP_ENTRY') {
      return sendError(res, 'A visitor with this phone number already exists.', 409);
    }
    return sendError(res, 'Failed to create visitor.', 500);
  }
};

// ── checkBlacklist ────────────────────────────────────────────────────────────
/**
 * GET /api/visitors/blacklist-check?phone=XXXXXXXXXX
 * Uses req.db (unit-scoped). Requires unit_code if unauthenticated (handled via optionalProtect).
 */
const checkBlacklist = async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone) return sendError(res, 'Query param "phone" is required.', 400);
    if (!req.db) return sendError(res, 'unit_code is required for unauthenticated requests.', 400);

    const [rows] = await req.db.query(
      `SELECT bv.id, bv.reason, bv.blacklisted_at
       FROM blacklisted_visitors bv
       JOIN visitors v ON v.id = bv.visitor_id
       WHERE v.phone = ? AND bv.is_active = TRUE
       LIMIT 1`,
      [phone]
    );

    if (rows.length > 0) {
      return sendSuccess(res, { blacklisted: true, details: rows[0] }, 'Visitor is blacklisted.');
    }
    return sendSuccess(res, { blacklisted: false }, 'Visitor is not blacklisted.');
  } catch (err) {
    console.error('[VisitorController] checkBlacklist error:', err.message);
    return sendError(res, 'Failed to check blacklist status.', 500);
  }
};

// ── getVisitor ────────────────────────────────────────────────────────────────
const getVisitor = async (req, res) => {
  try {
    const { id } = req.params;

    const [visitors] = await req.db.query(
      `SELECT id, full_name, email, phone, address, is_mobile_verified, created_at, updated_at
       FROM visitors WHERE id = ?`,
      [id]
    );
    if (visitors.length === 0) return sendError(res, 'Visitor not found.', 404);

    const visitor = visitors[0];

    const [idProofs] = await req.db.query(
      `SELECT id, id_type, id_number, is_primary, created_at FROM visitor_documents WHERE visitor_id = ?`,
      [id]
    );

    const [blacklist] = await req.db.query(
      `SELECT id, reason, blacklisted_at FROM blacklisted_visitors WHERE visitor_id = ? AND is_active = TRUE LIMIT 1`,
      [id]
    );

    // Visit history for this visitor
    const [visitHistory] = await req.db.query(
      `SELECT vr.id, vr.visit_date, vr.visit_category, vr.purpose, vr.status,
              h.full_name AS host_name, d.name AS department_name
       FROM visit_requests vr
       JOIN users h ON h.id = vr.host_user_id
       LEFT JOIN departments d ON d.id = vr.department_id
       WHERE vr.visitor_id = ?
       ORDER BY vr.visit_date DESC LIMIT 20`,
      [id]
    );

    return sendSuccess(res, {
      ...visitor,
      id_proofs:        idProofs,
      blacklisted:      blacklist.length > 0,
      blacklist_details: blacklist[0] || null,
      visit_history:    visitHistory,
    }, 'Visitor fetched successfully.');
  } catch (err) {
    console.error('[VisitorController] getVisitor error:', err.message);
    return sendError(res, 'Failed to fetch visitor.', 500);
  }
};

// ── listVisitors ──────────────────────────────────────────────────────────────
const listVisitors = async (req, res) => {
  try {
    const search = req.query.search || '';
    const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const like   = `%${search}%`;

    const [rows] = await req.db.query(
      `SELECT v.id, v.full_name, v.email, v.phone, v.is_mobile_verified, v.created_at,
              (SELECT 1 FROM blacklisted_visitors bv WHERE bv.visitor_id = v.id AND bv.is_active = TRUE LIMIT 1) AS is_blacklisted
       FROM visitors v
       WHERE v.full_name LIKE ? OR v.phone LIKE ?
       ORDER BY v.created_at DESC
       LIMIT ? OFFSET ?`,
      [like, like, limit, offset]
    );

    const [[{ total }]] = await req.db.query(
      `SELECT COUNT(*) AS total FROM visitors WHERE full_name LIKE ? OR phone LIKE ?`,
      [like, like]
    );

    return sendSuccess(res, {
      visitors:   rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    }, 'Visitors fetched successfully.');
  } catch (err) {
    console.error('[VisitorController] listVisitors error:', err.message);
    return sendError(res, 'Failed to list visitors.', 500);
  }
};

// ── addToBlacklist ────────────────────────────────────────────────────────────
/**
 * POST /api/visitors/:id/blacklist — unit_admin / super_admin only
 */
const addToBlacklist = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) return sendError(res, 'reason is required.', 400);

    // Confirm visitor exists
    const [vRows] = await req.db.query('SELECT id FROM visitors WHERE id = ?', [id]);
    if (!vRows.length) return sendError(res, 'Visitor not found.', 404);

    // Check already blacklisted
    const [blRows] = await req.db.query(
      'SELECT id FROM blacklisted_visitors WHERE visitor_id = ? AND is_active = TRUE LIMIT 1', [id]
    );
    if (blRows.length > 0) return sendError(res, 'Visitor is already blacklisted.', 409);

    await req.db.query(
      `INSERT INTO blacklisted_visitors (visitor_id, reason, blacklisted_by, is_active, blacklisted_at, created_at)
       VALUES (?, ?, ?, TRUE, NOW(), NOW())`,
      [id, reason.trim(), req.user.id]
    );

    return sendSuccess(res, null, 'Visitor added to blacklist.');
  } catch (err) {
    console.error('[VisitorController] addToBlacklist error:', err.message);
    return sendError(res, 'Failed to blacklist visitor.', 500);
  }
};

// ── liftBlacklist ─────────────────────────────────────────────────────────────
/**
 * PUT /api/visitors/:id/blacklist/lift — unit_admin / super_admin only
 */
const liftBlacklist = async (req, res) => {
  try {
    const { id } = req.params;
    const { lift_reason } = req.body;

    const [blRows] = await req.db.query(
      'SELECT id FROM blacklisted_visitors WHERE visitor_id = ? AND is_active = TRUE LIMIT 1', [id]
    );
    if (!blRows.length) return sendError(res, 'Visitor is not currently blacklisted.', 404);

    await req.db.query(
      `UPDATE blacklisted_visitors
       SET is_active = FALSE, lifted_at = NOW(), lifted_by = ?, lift_reason = ?
       WHERE visitor_id = ? AND is_active = TRUE`,
      [req.user.id, lift_reason || null, id]
    );

    return sendSuccess(res, null, 'Blacklist lifted successfully.');
  } catch (err) {
    console.error('[VisitorController] liftBlacklist error:', err.message);
    return sendError(res, 'Failed to lift blacklist.', 500);
  }
};

// ── lookupVisitorByPhone ──────────────────────────────────────────────────────
/**
 * GET /api/visitors/lookup?phone=XXXXXXXXXX
 * Returns visitor data if a record exists for that phone, otherwise found:false.
 * Used by the visit-request form for real-time phone-based auto-fill.
 */
const lookupVisitorByPhone = async (req, res) => {
  try {
    const { phone, unit_id } = req.query;
    if (!phone || phone.trim().length < 5) {
      return sendError(res, 'phone query param is required (min 5 digits).', 400);
    }

    // Normalize: strip non-digits, use last 10 for fuzzy match
    const cleaned = phone.trim().replace(/\D/g, '');
    const last10  = cleaned.length >= 10 ? cleaned.slice(-10) : cleaned;

    // Resolve the correct DB pool.
    // super_admin tokens use the centralPool — fall back to unit DB via unit_id param.
    let db = req.db;
    const { getPool, centralPool, CENTRAL_DB_NAME } = require('../services/dbManager');
    const isCentralUser = req.user?.unit_db === 'central' || req.user?.unit_db === CENTRAL_DB_NAME || !req.user?.unit_db;

    if (isCentralUser) {
      const targetUnitId = unit_id || req.user?.unit_id;
      if (targetUnitId) {
        const [unitRows] = await centralPool.query(
          'SELECT db_name FROM units WHERE id = ? AND is_active = 1 LIMIT 1', [targetUnitId]
        );
        if (unitRows.length > 0) db = getPool(unitRows[0].db_name);
      }
      if (db === centralPool) {
        return sendSuccess(res, { found: false, visitor: null }, 'Cannot lookup from central admin context without unit_id.');
      }
    }

    // ── Search past visit_requests for this phone number ─────────────────────
    // The visitors table is only populated at check-in. To auto-fill the form
    // for returning visitors, we look up their most recent visit request instead.
    const [rows] = await db.query(
      `SELECT 
         vr.visitor_name AS full_name, 
         vr.visitor_phone AS phone, 
         vr.visitor_email AS email,
         COALESCE(v.visitor_type, IF(vr.visit_category = 'VENDOR', 'business', 'individual')) AS visitor_type
       FROM visit_requests vr
       LEFT JOIN visitors v ON (vr.visitor_id = v.id OR vr.visitor_phone = v.phone)
       WHERE (
         vr.visitor_phone = ?
         OR vr.visitor_phone = ?
         OR REPLACE(REPLACE(REPLACE(vr.visitor_phone, ' ', ''), '-', ''), '+', '') = ?
         OR RIGHT(REPLACE(REPLACE(REPLACE(vr.visitor_phone, ' ', ''), '-', ''), '+', ''), 10) = ?
       )
       AND vr.visitor_name IS NOT NULL
       ORDER BY vr.created_at DESC
       LIMIT 1`,
      [phone.trim(), cleaned, cleaned, last10]
    );

    if (rows.length === 0) {
      return sendSuccess(res, { found: false, visitor: null }, 'No previous visit found for this phone number.');
    }

    return sendSuccess(res, { found: true, visitor: rows[0] }, 'Previous visit record found.');
  } catch (err) {
    console.error('[VisitorController] lookupVisitorByPhone error:', err.message);
    return sendError(res, 'Failed to lookup visitor.', 500);
  }
};

module.exports = { createVisitor, checkBlacklist, getVisitor, listVisitors, addToBlacklist, liftBlacklist, lookupVisitorByPhone };

