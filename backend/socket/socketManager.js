// backend/socket/socketManager.js
'use strict';

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { centralPool, getPool } = require('../services/dbManager');
const { issuedBeforePasswordChange } = require('../middlewares/auth.middleware');

let io = null;

/**
 * initSocket(httpServer)
 * Call once in server.js after creating the HTTP server.
 * Attaches Socket.IO, authenticates clients via JWT, and joins them to rooms.
 */
function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      // Same rule as the REST API (server.js): localhost origins only outside production
      origin: [
        process.env.CLIENT_URL,
        process.env.NODE_ENV !== 'production' && 'http://localhost:5173',
        process.env.NODE_ENV !== 'production' && 'http://localhost:5174',
        process.env.NODE_ENV !== 'production' && 'http://localhost:5175',
      ].filter(Boolean),
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // ── JWT Authentication middleware ──────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      // Visitor portal (auth.visitorSession = the X-Visitor-Session token): live updates
      // of their own visits only — see emitToVisitorPhone
      const visitorSession = socket.handshake.auth?.visitorSession;
      if (visitorSession) {
        const v = jwt.verify(visitorSession, process.env.JWT_SECRET);
        if (v.purpose !== 'VISITOR_SESSION' || !v.aid) return next(new Error('INVALID_TOKEN'));
        const [[account]] = await centralPool.query(
          'SELECT id, phone, is_active, phone_verified_at, password_changed_at FROM visitor_accounts WHERE id = ? LIMIT 1', [v.aid]
        );
        if (!account || !account.is_active) return next(new Error('INVALID_TOKEN'));
        // A password change ends older sessions (same rule as the portal API)
        const pwv = account.password_changed_at ? new Date(account.password_changed_at).getTime() : 0;
        if ((v.pwv ?? 0) !== pwv) return next(new Error('INVALID_TOKEN'));
        socket.visitor = { id: account.id, phone: account.phone, verified: !!account.phone_verified_at };
        return next();
      }

      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) return next(new Error('AUTH_REQUIRED'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      // JWT payload is: { userId, role, unit_db }
      // We need the full user (id, role_type, unit_id) from the DB

      const userId = decoded.userId || decoded.id;
      const unitDb = decoded.unit_db;

      if (!userId) return next(new Error('INVALID_TOKEN'));
      // Reject the pre-OTP loginToken and any token without a unit_db claim
      if (decoded.otp_pending || !unitDb) return next(new Error('INVALID_TOKEN'));

      let user = null;

      if (unitDb && unitDb !== 'central') {
        // Unit user — query the unit database
        const db = getPool(unitDb);
        const [rows] = await db.query(
          `SELECT id, role_type, unit_id, department_id, full_name, password_changed_at
           FROM users WHERE id = ? AND is_active = 1 AND deleted_at IS NULL`,
          [userId]
        );
        user = rows[0] || null;
      } else {
        // Central user (super_admin / global_auditor)
        const [rows] = await centralPool.query(
          `SELECT id, role_type, NULL AS unit_id, NULL AS department_id, full_name, password_changed_at
           FROM users WHERE id = ? AND is_active = 1 AND deleted_at IS NULL`,
          [userId]
        );
        user = rows[0] || null;
      }

      if (!user) return next(new Error('USER_NOT_FOUND'));
      if (issuedBeforePasswordChange(decoded, user)) return next(new Error('INVALID_TOKEN'));
      delete user.password_changed_at;

      socket.user = user;
      socket.user.unit_db = unitDb;
      next();
    } catch (err) {
      console.error('[Socket] Auth error:', err.message);
      next(new Error('INVALID_TOKEN'));
    }
  });

  // ── Connection handler ─────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    // Visitor portal: only their own room (their visits are found by mobile number,
    // so only once that number is verified)
    if (socket.visitor) {
      if (socket.visitor.verified) socket.join(`visitor:${socket.visitor.phone}`);
      return;
    }

    const { id: userId, role_type, unit_id, unit_db } = socket.user;

    // Personal room — scoped by unit DB to prevent cross-unit ID collisions
    // e.g. user:vms_unit_ho:2  ≠  user:vms_unit_u2:2
    const unitDbKey = unit_db || 'central';
    socket.join(`user:${unitDbKey}:${userId}`);

    // Security room — receives gate events for this unit
    const SECURITY_ROLES = ['security', 'receptionist', 'unit_admin', 'super_admin'];
    if (unit_id && SECURITY_ROLES.includes(role_type)) {
      socket.join(`unit:${unit_id}:security`);
    }

    // Unit-wide room — all users of a unit
    if (unit_id) {
      socket.join(`unit:${unit_id}:all`);
    }


    socket.on('disconnect', () => {
    });
  });

  return io;
}

/** Returns the Socket.IO singleton. Throws if initSocket() not yet called. */
function getIO() {
  if (!io) throw new Error('[Socket] initSocket() not called yet');
  return io;
}

/**
 * Emit to a specific user's personal room.
 * @param {number} userId  - The user's numeric ID within their unit DB.
 * @param {string} unitDb  - The user's unit DB name (e.g. 'vms_unit_ho').
 *                          Pass 'central' for super_admin / global_auditor.
 * @param {string} event   - Socket event name.
 * @param {object} data    - Payload.
 */
function emitToUser(userId, unitDb, event, data) {
 
  if (!io) {
    console.warn('[Socket] emitToUser failed: io is not initialized');
    return;
  }
  const dbKey = unitDb || 'central';
  const roomName = `user:${dbKey}:${userId}`;
  io.to(roomName).emit(event, data);
  // Also as a system notification on their browsers / phone (when the app isn't in view)
  push().pushToUser(userId, dbKey, event, data);
}

/** Emit to all security/gate users of a unit. */
function emitToUnitSecurity(unitId, event, data) {
  if (!io) {
    console.warn('[Socket] emitToUnitSecurity failed: io is not initialized');
    return;
  }
  io.to(`unit:${unitId}:security`).emit(event, data);
  push().pushToUnitSecurity(unitId, event, data);
}

/**
 * Emit to the unit admins of a unit (they can approve any request there).
 * @param {number}   unitId
 * @param {string}   unitDb       - the unit's DB name (for their push subscriptions)
 * @param {number[]} [skipUserIds] - e.g. the host, who already got their own copy
 */
async function emitToUnitAdmins(unitId, unitDb, event, data, skipUserIds = []) {
  if (!io || !unitId) return;
  try {
    const [admins] = await getPool(unitDb).query(
      "SELECT id FROM users WHERE role_type = 'unit_admin' AND is_active = 1 AND deleted_at IS NULL"
    );
    for (const a of admins) {
      if (!skipUserIds.map(Number).includes(Number(a.id))) emitToUser(a.id, unitDb, event, data);
    }
  } catch (err) {
    console.warn('[Socket] emitToUnitAdmins failed:', err.message);
  }
}

/**
 * Tells a unit's gate screens (security dashboard, Spot Visits) that its visits changed —
 * approved for any day, declined, cancelled, expired — so they reload quietly. No push.
 * @param {number} unitId
 * @param {string} reason — 'approved' | 'rejected' | 'cancelled' | 'expired'
 */
function emitGateChanged(unitId, reason) {
  if (!io || !unitId) return;
  io.to(`unit:${unitId}:security`).emit('gate:changed', { reason });
}

/**
 * A visitor's visit changed (submitted, approved, declined, cancelled, checked in / out):
 * their open visitor-portal tabs reload it, and show `data.title` / `data.body` as a
 * message when given. Matched by the mobile number's last 10 digits.
 */
function emitToVisitorPhone(phone, data) {
  const ten = String(phone || '').replace(/\D/g, '').slice(-10);
  if (!io || ten.length !== 10) return;
  io.to(`visitor:${ten}`).emit('visitor:visit:changed', data || {});
}

/** Emit to ALL connected users of a unit. */
function emitToUnit(unitId, event, data) {
  if (!io) {
    console.warn('[Socket] emitToUnit failed: io is not initialized');
    return;
  }
  io.to(`unit:${unitId}:all`).emit(event, data);
}

// push.service is loaded lazily (it needs the DB pools; keeps start-up order simple)
const push = () => require('../services/push.service');

module.exports = {
  initSocket, getIO, emitToUser, emitToUnitSecurity, emitToUnit, emitToUnitAdmins, emitGateChanged, emitToVisitorPhone,
};
