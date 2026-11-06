// backend/services/visitExpiry.service.js
'use strict';

/**
 * A visit is valid only on its date. Once the date has passed (IST), a visit the
 * visitor never entered for becomes EXPIRED, and so does its unused gate pass:
 *
 *   visit_requests  PENDING / APPROVED / SCHEDULED, no check-in → EXPIRED
 *   gate_passes     ISSUED                                       → EXPIRED
 *
 * A visitor checked in but never checked out at the gate is checked out automatically
 * once the visit date has passed — like a normal check-out: the visit log COMPLETED
 * (check-out at the end of the visit day, no staff member, a note saying so), the
 * request COMPLETED and the pass EXPIRED. So nobody stays "on premises" forever.
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
 * Expires every past-dated visit and unused pass in one unit database, and checks out
 * visitors left "inside" after their visit date.
 * @param {object} db — unit pool
 * @returns {Promise<{ visits: number, passes: number, autoCheckedOut: number }>}
 */
async function expirePastVisits(db) {
  const today = istDate();

  // Checked in, never checked out, visit date over → closed like a check-out
  const [closed] = await db.query(
    `UPDATE visit_logs vl
       JOIN visit_requests vr ON vr.id = vl.visit_request_id
        SET vl.status = 'COMPLETED',
            vl.check_out_at = TIMESTAMP(vr.visit_date, '23:59:59'),
            vl.remarks = CONCAT_WS(' · ', NULLIF(vl.remarks, ''), 'Not checked out at the gate — checked out automatically after the visit date')
      WHERE vl.status = 'ACTIVE' AND vr.visit_date < ?`,
    [today]
  );
  if (closed.affectedRows) {
    await db.query(
      `UPDATE gate_passes gp
         JOIN visit_requests vr ON vr.id = gp.visit_request_id
          SET gp.status = 'EXPIRED', gp.qr_expires_at = LEAST(COALESCE(gp.qr_expires_at, NOW()), NOW())
        WHERE gp.status = 'USED' AND vr.visit_date < ?`,
      [today]
    );
    await db.query(
      `UPDATE visit_requests vr
          SET vr.status = 'COMPLETED'
        WHERE vr.status IN ('APPROVED', 'SCHEDULED') AND vr.visit_date < ?
          AND EXISTS (SELECT 1 FROM visit_logs vl WHERE vl.visit_request_id = vr.id AND vl.status = 'COMPLETED')`,
      [today]
    );
  }

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
  return { visits: visits.affectedRows, passes: passes.affectedRows, autoCheckedOut: closed.affectedRows };
}

/** Gate screens of the unit with this DB reload quietly (socketManager is loaded lazily — no require cycle). */
async function gateChanged(dbName) {
  try {
    const [[unit]] = await centralPool.query('SELECT id FROM units WHERE db_name = ? LIMIT 1', [dbName]);
    if (unit) require('../socket/socketManager').emitGateChanged(unit.id, 'expired');
  } catch { /* the screens catch up on their next reload */ }
}

/** Sweeps this unit DB if it hasn't been swept today. Never throws (lists must still load). */
async function expireIfDue(db, dbName) {
  if (!db || !dbName) return;
  const today = istDate();
  if (sweptOn.get(dbName) === today) return;
  try {
    const done = await expirePastVisits(db);
    sweptOn.set(dbName, today);
    if (done && (done.visits || done.passes || done.autoCheckedOut)) gateChanged(dbName);
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
