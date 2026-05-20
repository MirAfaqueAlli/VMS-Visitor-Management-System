// backend/controllers/visitor.controller.js
'use strict';

const pool           = require('../db');
const { sendSuccess, sendError } = require('../utils/response.util');

// ── createVisitor ─────────────────────────────────────────────────────────────
/**
 * POST /api/visitors — Public
 * Body: { full_name, phone, email?, address?, id_type?, id_number? }
 */
const createVisitor = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { 
      full_name, phone, email, address, id_type, id_number, visitor_type,
      organization_id, visit_category, company_name, contact_person_name, gst_number, service_type, access_zone 
    } = req.body;

    // Check if visitor with this phone already exists
    const [existing] = await conn.query(
      `SELECT v.*, 
              vip.id_type, vip.id_number, vip.is_primary
         FROM visitors v
         LEFT JOIN visitor_documents vip ON vip.visitor_id = v.id AND vip.is_primary = TRUE
        WHERE v.phone = ?
        LIMIT 1`,
      [phone]
    );

    if (existing.length > 0) {
      conn.release();
      return sendError(res, 'A visitor with this phone number already exists.', 409);
    }

    await conn.beginTransaction();

    const photoPath = req.file ? `/uploads/visitor-photos/${req.file.filename}` : null;

    // Insert new visitor
    const [result] = await conn.query(
      `INSERT INTO visitors (full_name, email, phone, address, visitor_type, photo_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [full_name, email || null, phone, address || null, visitor_type, photoPath]
    );

    const visitorId = result.insertId;

    // Optionally insert primary ID proof
    if (id_type && id_number) {
      await conn.query(
        `INSERT INTO visitor_documents (visitor_id, id_type, id_number, is_primary, created_at)
         VALUES (?, ?, ?, TRUE, NOW())`,
        [visitorId, id_type, id_number]
      );
    }

    // Insert details if organization_id is provided
    if (organization_id) {
      if (visitor_type === 'business') {
        await conn.query(
          `INSERT INTO business_visitor_details (organization_id, visitor_id, company_name, contact_person_name, gst_number, service_type, access_zone, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
          [organization_id, visitorId, company_name || 'Unknown Company', contact_person_name || null, gst_number || null, service_type || null, access_zone || null]
        );
      } else {
        await conn.query(
          `INSERT INTO individual_visitor_details (organization_id, visitor_id, address, visit_category, created_at)
           VALUES (?, ?, ?, ?, NOW())`,
          [organization_id, visitorId, address || null, visit_category || null]
        );
      }
    }

    await conn.commit();

    const [newVisitor] = await conn.query(
      `SELECT v.*, 
              vip.id_type, vip.id_number, vip.is_primary
         FROM visitors v
         LEFT JOIN visitor_documents vip ON vip.visitor_id = v.id AND vip.is_primary = TRUE
        WHERE v.id = ?`,
      [visitorId]
    );

    conn.release();
    return sendSuccess(res, newVisitor[0], 'Visitor created successfully', 201);
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch(_) {}
      conn.release();
    }
    console.error('[VisitorController] createVisitor error:', err.message);
    if (err.code === 'ER_DUP_ENTRY') {
      return sendError(res, 'A visitor with this phone number already exists.', 409);
    }
    return sendError(res, 'Failed to create visitor.', 500);
  }
};

// ── checkBlacklist ────────────────────────────────────────────────────────────
/**
 * GET /api/visitors/blacklist-check?phone=9876543210 — Public
 */
const checkBlacklist = async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone) {
      return sendError(res, 'Query param "phone" is required.', 400);
    }

    const [rows] = await pool.query(
      `SELECT bv.id, bv.reason, bv.blacklisted_at
         FROM blacklisted_visitors bv
         JOIN visitors v ON v.id = bv.visitor_id
        WHERE v.phone = ? AND bv.is_active = TRUE AND v.deleted_at IS NULL
        LIMIT 1`,
      [phone]
    );

    if (rows.length > 0) {
      return sendSuccess(res, { blacklisted: true, details: rows[0] }, 'Visitor is blacklisted', 200);
    }

    return sendSuccess(res, { blacklisted: false }, 'Visitor is not blacklisted', 200);
  } catch (err) {
    console.error('[VisitorController] checkBlacklist error:', err.message);
    return sendError(res, 'Failed to check blacklist status.', 500);
  }
};

// ── getVisitor ────────────────────────────────────────────────────────────────
/**
 * GET /api/visitors/:id — Protected (any role)
 */
const getVisitor = async (req, res) => {
  try {
    const { id } = req.params;

    const [visitors] = await pool.query(
      `SELECT id, full_name, visitor_type, email, phone, address, photo_path, is_mobile_verified, created_at, updated_at
         FROM visitors
        WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );

    if (visitors.length === 0) {
      return sendError(res, 'Visitor not found.', 404);
    }

    const visitor = visitors[0];

    // Fetch details based on visitor type
    let details = [];
    if (visitor.visitor_type === 'business') {
      [details] = await pool.query(`SELECT * FROM business_visitor_details WHERE visitor_id = ?`, [id]);
    } else {
      [details] = await pool.query(`SELECT * FROM individual_visitor_details WHERE visitor_id = ?`, [id]);
    }

    // Fetch all ID proofs
    const [idProofs] = await pool.query(
      `SELECT id, id_type, id_number, is_primary, verified_by, verified_at, expiry_date, created_at
         FROM visitor_documents
        WHERE visitor_id = ?`,
      [id]
    );

    // Check blacklist status
    const [blacklist] = await pool.query(
      `SELECT id, reason, blacklisted_at
         FROM blacklisted_visitors
        WHERE visitor_id = ? AND is_active = TRUE
        LIMIT 1`,
      [id]
    );

    return sendSuccess(res, {
      ...visitor,
      visitor_details: details,
      id_proofs: idProofs,
      blacklisted: blacklist.length > 0,
      blacklist_details: blacklist[0] || null,
    }, 'Visitor fetched successfully');
  } catch (err) {
    console.error('[VisitorController] getVisitor error:', err.message);
    return sendError(res, 'Failed to fetch visitor.', 500);
  }
};

// ── listVisitors ──────────────────────────────────────────────────────────────
/**
 * GET /api/visitors?search=&page=1&limit=20 — Protected (admin, security, receptionist)
 */
const listVisitors = async (req, res) => {
  try {
    const search = req.query.search || '';
    const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const likeVal = `%${search}%`;

    const [rows] = await pool.query(
      `SELECT v.id AS visitor_id, v.full_name, v.email, v.phone, v.visitor_type, v.is_mobile_verified,
              v.created_at,
              bvd.company_name,
              (SELECT 1 FROM blacklisted_visitors bv WHERE bv.visitor_id = v.id AND bv.is_active = TRUE LIMIT 1) AS is_blacklisted
         FROM visitors v
         LEFT JOIN business_visitor_details bvd ON bvd.visitor_id = v.id
        WHERE (v.full_name LIKE ? OR v.phone LIKE ?) AND v.deleted_at IS NULL
        ORDER BY v.created_at DESC
        LIMIT ? OFFSET ?`,
      [likeVal, likeVal, limit, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM visitors WHERE (full_name LIKE ? OR phone LIKE ?) AND deleted_at IS NULL`,
      [likeVal, likeVal]
    );

    return sendSuccess(res, {
      visitors: rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    }, 'Visitors fetched successfully');
  } catch (err) {
    console.error('[VisitorController] listVisitors error:', err.message);
    return sendError(res, 'Failed to list visitors.', 500);
  }
};

module.exports = { createVisitor, checkBlacklist, getVisitor, listVisitors };
