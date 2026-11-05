// backend/services/visitEvents.service.js
'use strict';

/**
 * Live (socket + push) announcements shared by more than one controller.
 */

const { centralPool } = require('./dbManager');
const { emitToUser, emitToUnitSecurity, emitToUnitAdmins } = require('../socket/socketManager');
const { visitDay } = require('./visitExpiry.service');

/**
 * A visit was cancelled: the host and the unit admins drop it from their inboxes,
 * and — when it was for today — the gate drops it from "expected today". Never throws.
 *
 * @param {number} unitId    — the unit the request lives in
 * @param {number} byUserId  — staff user who cancelled (no copy to them); null when the visitor did
 * @param {object} payload   — { visit_request_id, host_user_id, visitor_name, visit_date, host_name, … }
 */
async function announceCancelled(unitId, byUserId, payload) {
  try {
    const [[unit]] = await centralPool.query('SELECT db_name FROM units WHERE id = ? LIMIT 1', [unitId]);
    if (!unit) return;
    const event = { ...payload, action: 'CANCELLED' };
    if (event.host_user_id && Number(event.host_user_id) !== Number(byUserId)) {
      emitToUser(event.host_user_id, unit.db_name, 'visit:actioned', event);
    }
    emitToUnitAdmins(unitId, unit.db_name, 'visit:actioned', event, [byUserId, event.host_user_id].filter(Boolean));
    if (visitDay(event.visit_date) === 'today') emitToUnitSecurity(unitId, 'visit:cancelled', event);
  } catch (err) {
    console.warn('[VisitEvents] announceCancelled failed:', err.message);
  }
}

module.exports = { announceCancelled };
