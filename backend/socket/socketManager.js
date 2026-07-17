// backend/socket/socketManager.js
'use strict';

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { centralPool, getPool } = require('../services/dbManager');

let io = null;

/**
 * initSocket(httpServer)
 * Call once in server.js after creating the HTTP server.
 * Attaches Socket.IO, authenticates clients via JWT, and joins them to rooms.
 */
function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: [
        process.env.CLIENT_URL,
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:5175',
      ].filter(Boolean),
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // ── JWT Authentication middleware ──────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
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

      let user = null;

      if (unitDb && unitDb !== 'central') {
        // Unit user — query the unit database
        const db = getPool(unitDb);
        const [rows] = await db.query(
          'SELECT id, role_type, unit_id, department_id, full_name FROM users WHERE id = ? AND is_active = 1',
          [userId]
        );
        user = rows[0] || null;
      } else {
        // Central user (super_admin / global_auditor)
        const [rows] = await centralPool.query(
          'SELECT id, role_type, NULL AS unit_id, NULL AS department_id, full_name FROM users WHERE id = ?',
          [userId]
        );
        user = rows[0] || null;
      }

      if (!user) return next(new Error('USER_NOT_FOUND'));

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
      console.log(`[Socket] user #${userId} disconnected`);
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
}

/** Emit to all security/gate users of a unit. */
function emitToUnitSecurity(unitId, event, data) {
  if (!io) {
    console.warn('[Socket] emitToUnitSecurity failed: io is not initialized');
    return;
  }
  const roomName = `unit:${unitId}:security`;
  const room = io.sockets.adapter.rooms.get(roomName);
  const socketCount = room ? room.size : 0;
 
  if (socketCount === 0) {
    console.warn(`[Socket] ⚠ NO sockets in room "${roomName}" — event "${event}" will NOT be received by anyone! Check that the security user is logged in and connected.`);
  }
  io.to(roomName).emit(event, data);
}

/** Emit to ALL connected users of a unit. */
function emitToUnit(unitId, event, data) {
  if (!io) {
    console.warn('[Socket] emitToUnit failed: io is not initialized');
    return;
  }
  const roomName = `unit:${unitId}:all`;
  const room = io.sockets.adapter.rooms.get(roomName);
  const socketCount = room ? room.size : 0;

  io.to(roomName).emit(event, data);
}

module.exports = { initSocket, getIO, emitToUser, emitToUnitSecurity, emitToUnit };
