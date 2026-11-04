// backend/services/visitExpiry.service.js
'use strict';

/**
 * A visit is valid only on its date. Once the date has passed (IST), a visit the
 * visitor never entered for becomes EXPIRED, and so does its unused gate pass:
 *
 *   visit_requests  PENDING / APPROVED / SCHEDULED, no check-in → EXPIRED
 *   gate_passes     ISSUED                                       → EXPIRED
 *
 * Visits with a check-in are left alone (completed / still inside / refused at the gate).
 *
 * Runs once per unit per IST day: from the scheduler (startReminderScheduler) and,
 * as a backstop, from the lists security and staff open (expireIfDue).
 */

const { centralPool, getPool, CENTRAL_DB_NAME } = require('./dbManager');

const istDate = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/** Last IST date each unit DB was swept (per process — the sweep is idempotent). */
const sweptOn = new Map();

/**
 * Expires every past-dated visit and unused pass in one unit database.
 * @param {object} db — unit pool
 * @returns {Promise<{ visits: number, passes: number }>}
 */
async function expirePastVisits(db) {
  const today = istDate();
  const [passes] = await db.query(
    `UPDATE gate_passes gp
       JOIN visit_requests vr ON vr.id = gp.visit_request_id
        SET gp.status = 'EXPIRED', gp.qr_expires_at = LEAST(COALESCE(gp.qr_expires_at, NOW()), NOW())
      WHERE gp.status = 'ISSUED' AND vr.visit_date < ?`,
    [today]
  );
  const [visits] = await db.query(
    `UPDATE visit_requests vr
        SET vr.status = 'EXPIRED'
      WHERE vr.status IN ('PENDING', 'APPROVED', 'SCHEDULED') AND vr.visit_date < ?
        AND NOT EXISTS (SELECT 1 FROM visit_logs vl WHERE vl.visit_request_id = vr.id)`,
    [today]
  );
  return { visits: visits.affectedRows, passes: passes.affectedRows };
}

/** Sweeps this unit DB if it hasn't been swept today. Never throws (lists must still load). */
async function expireIfDue(db, dbName) {
  if (!db || !dbName) return;
  const today = istDate();
  if (sweptOn.get(dbName) === today) return;
  try {
    await expirePastVisits(db);
    sweptOn.set(dbName, today);
  } catch (err) {
    console.error(`[VisitExpiry] ${dbName} sweep failed:`, err.message);
  }
}

/** Sweeps the unit the signed-in user is working in (their own, or the one a super admin manages). */
async function expireForRequest(req) {
  const own = req.user?.unit_db;
  const dbName = req.unitDbName || (own && own !== 'central' && own !== CENTRAL_DB_NAME ? own : null);
  if (dbName) await expireIfDue(req.db, dbName);
}

/** Sweeps every active unit (scheduler). */
async function expireAllUnits() {
  const [units] = await centralPool.query("SELECT db_name FROM units WHERE is_active = 1 AND db_status = 'ACTIVE'");
  for (const u of units) await expireIfDue(getPool(u.db_name), u.db_name);
}

/**
 * Where a visit stands against today (IST): 'past' | 'today' | 'future'.
 * @param {Date|string} visitDate
 */
const visitDay = (visitDate) => {
  if (!visitDate) return null;
  const d = istDate(new Date(visitDate));
  const t = istDate();
  return d < t ? 'past' : d > t ? 'future' : 'today';
};

module.exports = { expirePastVisits, expireIfDue, expireForRequest, expireAllUnits, visitDay, istDate };
