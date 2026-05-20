// backend/middlewares/auth.middleware.js
'use strict';

const jwt = require('jsonwebtoken');
const db  = require('../db');
const { sendError } = require('../utils/response.util');

/**
 * Express middleware — protect
 *
 * Validates the Bearer JWT from the Authorization header, looks up the full
 * user record (including role slug), verifies the account is active, and
 * attaches the user object to req.user before calling next().
 */
const protect = async (req, res, next) => {
  try {
    // ── 1. Extract token ─────────────────────────────────────────────────────
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(
        res,
        'Access denied. No authentication token provided.',
        401
      );
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return sendError(res, 'Access denied. Token is missing.', 401);
    }

    // ── 2. Verify token ───────────────────────────────────────────────────────
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') {
        return sendError(res, 'Session expired. Please log in again.', 401);
      }
      return sendError(res, 'Invalid authentication token.', 401);
    }

    const { userId } = decoded;

    // ── 3. Fetch user from DB ─────────────────────────────────────────────────
    const [rows] = await db.query(
      `SELECT
          u.id,
          u.organization_id,
          u.department_id,
          
          u.employee_code,
          u.full_name,
          u.email,
          u.phone,
          u.designation,
          u.is_active,
          u.last_login_at,
          u.created_at,
          u.role_type AS role_type
       FROM users u
       
       WHERE u.id = ? AND u.deleted_at IS NULL`,
      [userId]
    );

    if (rows.length === 0) {
      return sendError(res, 'User associated with this token no longer exists.', 401);
    }

    const user = rows[0];

    // ── 4. Check account is active ────────────────────────────────────────────
    if (user.is_active !== 1) {
      return sendError(
        res,
        'Your account has been deactivated. Please contact an administrator.',
        401
      );
    }

    // ── 5. Attach user to request and continue ────────────────────────────────
    req.user = user;
    next();
  } catch (err) {
    console.error('[AuthMiddleware] Unexpected error:', err.message);
    return sendError(res, 'Authentication failed due to a server error.', 500);
  }
};

module.exports = { protect };
