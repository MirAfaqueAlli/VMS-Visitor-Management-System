// backend/middlewares/auth.middleware.js
'use strict';

const jwt = require('jsonwebtoken');
const { getPool, centralPool, CENTRAL_DB_NAME } = require('../services/dbManager');
const { sendError } = require('../utils/response.util');

/**
 * protect — JWT auth middleware for multi-database architecture.
 *
 * 1. Extracts and verifies the Bearer JWT.
 * 2. Reads `unit_db` from the token payload.
 * 3. Resolves the correct MySQL pool for that database.
 * 4. Fetches the user from that specific database.
 * 5. Attaches `req.user` and `req.db` for downstream controllers.
 *
 * SECURITY: A token issued for 'vms_unit_hq' will ONLY query that database.
 * Even if the token is tampered, the middleware resolves the pool from the
 * token claim — the user simply won't exist in another unit's database.
 */
const protect = async (req, res, next) => {
  try {
    // ── 1. Extract token ─────────────────────────────────────────────────────
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(res, 'Access denied. No authentication token provided.', 401);
    }
    const token = authHeader.split(' ')[1];
    if (!token) return sendError(res, 'Access denied. Token is missing.', 401);

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

    const { userId, unit_db } = decoded;

    if (!userId) return sendError(res, 'Malformed token: missing userId.', 401);

    // ── 3. Resolve the correct DB pool ────────────────────────────────────────
    // super_admin and global_auditor use 'central', everyone else uses their unit DB
    let pool;
    if (!unit_db || unit_db === 'central' || unit_db === CENTRAL_DB_NAME) {
      pool = centralPool;
    } else {
      try {
        pool = getPool(unit_db);
      } catch (poolErr) {
        console.error('[AuthMiddleware] Failed to resolve pool for unit_db:', unit_db, poolErr.message);
        return sendError(res, 'Authentication failed: invalid unit database reference.', 401);
      }
    }

    // ── 4. Fetch user from the resolved DB ────────────────────────────────────
    // Central users (super_admin, global_auditor) have a simpler schema
    let rows;
    const isCentral = !unit_db || unit_db === 'central' || unit_db === CENTRAL_DB_NAME;

    if (isCentral) {
      [rows] = await pool.query(
        `SELECT id, role_type, full_name, email, phone, employee_code,
                is_active, last_login_at, NULL AS department_id, NULL AS unit_id,
                NULL AS designation_id, NULL AS designation, NULL AS department_name
         FROM users
         WHERE id = ? AND deleted_at IS NULL`,
        [userId]
      );
    } else {
      [rows] = await pool.query(
        `SELECT u.id, u.role_type, u.full_name, u.email, u.phone, u.employee_code,
                u.is_active, u.last_login_at, u.department_id, u.unit_id,
                u.designation_id, u.designation,
                d.name AS department_name
         FROM users u
         LEFT JOIN departments d ON d.id = u.department_id
         WHERE u.id = ? AND u.deleted_at IS NULL`,
        [userId]
      );
    }

    if (rows.length === 0) {
      return sendError(res, 'User associated with this token no longer exists.', 401);
    }

    const user = rows[0];

    // ── 5. Check account is active ────────────────────────────────────────────
    if (!user.is_active) {
      return sendError(res, 'Your account has been deactivated. Please contact an administrator.', 401);
    }

    // ── 6. Attach to request ──────────────────────────────────────────────────
    req.user         = user;
    req.user.unit_db = unit_db || 'central'; // carry forward for logging
    req.db           = pool;                  // ← controllers use this, NOT the global import

    // Support dynamic unit database overriding for central users (super_admin / global_auditor)
    if (isCentral) {
      const targetUnitDb = req.headers['x-unit-db'];
      const targetUnitId = req.headers['x-unit-id'];

      if (targetUnitDb) {
        try {
          req.db = getPool(targetUnitDb);
        } catch (poolErr) {
          console.error('[AuthMiddleware] SuperAdmin override failed for DB:', targetUnitDb, poolErr.message);
        }
      } else if (targetUnitId) {
        try {
          const [unitRows] = await centralPool.query(
            'SELECT db_name FROM units WHERE id = ? AND is_active = 1 LIMIT 1',
            [parseInt(targetUnitId, 10)]
          );
          if (unitRows.length > 0) {
            req.db = getPool(unitRows[0].db_name);
          }
        } catch (unitErr) {
          console.error('[AuthMiddleware] SuperAdmin override failed for Unit ID:', targetUnitId, unitErr.message);
        }
      }
    }

    next();
  } catch (err) {
    console.error('[AuthMiddleware] Unexpected error:', err.message);
    return sendError(res, 'Authentication failed due to a server error.', 500);
  }
};


/**
 * optionalProtect — like protect, but silently skips if no/invalid token.
 * Sets req.user and req.db if token is valid; otherwise calls next() without them.
 * Use for endpoints that serve both authenticated and unauthenticated callers.
 */
const optionalProtect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return next();

    const token = authHeader.split(' ')[1];
    if (!token) return next();

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (_) {
      return next(); // expired or invalid — treat as unauthenticated
    }

    const { userId, unit_db } = decoded;
    if (!userId) return next();

    let pool;
    if (!unit_db || unit_db === 'central' || unit_db === CENTRAL_DB_NAME) {
      pool = centralPool;
    } else {
      try { pool = getPool(unit_db); } catch (_) { return next(); }
    }

    const isCentral = !unit_db || unit_db === 'central' || unit_db === CENTRAL_DB_NAME;
    let rows;
    if (isCentral) {
      [rows] = await pool.query(
        `SELECT id, role_type, full_name, email, phone, employee_code,
                is_active, NULL AS department_id, NULL AS unit_id,
                NULL AS designation_id, NULL AS designation
         FROM users WHERE id = ? AND deleted_at IS NULL`,
        [userId]
      );
    } else {
      [rows] = await pool.query(
        `SELECT u.id, u.role_type, u.full_name, u.email, u.phone, u.employee_code,
                u.is_active, u.department_id, u.unit_id,
                u.designation_id, u.designation
         FROM users u
         WHERE u.id = ? AND u.deleted_at IS NULL`,
        [userId]
      );
    }

    if (rows.length > 0 && rows[0].is_active) {
      req.user         = rows[0];
      req.user.unit_db = unit_db || 'central';
      req.db           = pool;

      // Support dynamic unit database overriding for central users in optional auth
      if (isCentral) {
        const targetUnitDb = req.headers['x-unit-db'];
        const targetUnitId = req.headers['x-unit-id'];

        if (targetUnitDb) {
          try {
            req.db = getPool(targetUnitDb);
          } catch (_) {}
        } else if (targetUnitId) {
          try {
            const [unitRows] = await centralPool.query(
              'SELECT db_name FROM units WHERE id = ? AND is_active = 1 LIMIT 1',
              [parseInt(targetUnitId, 10)]
            );
            if (unitRows.length > 0) {
              req.db = getPool(unitRows[0].db_name);
            }
          } catch (_) {}
        }
      }
    }
  } catch (_) {
    // swallow all errors — proceed as unauthenticated
  }
  next();
};

module.exports = { protect, optionalProtect };
