// backend/utils/auditLogger.util.js
'use strict';

const { centralPool } = require('../services/dbManager');

/**
 * logAudit({ db, userId, action, module, recordType, recordId,
 *            oldValues, newValues, ipAddress, userAgent,
 *            isSuperAdminAction, sourceUnit })
 *
 * Dual audit logging:
 * - If `db` is provided → writes to that unit's `audit_logs` table
 * - If `isSuperAdminAction` is true → ALSO writes to `vms_central.global_audit_logs`
 *
 * This function is intentionally fire-and-forget safe — it will NEVER throw.
 *
 * @param {object}       params
 * @param {object|null}  [params.db]               - Unit DB pool (req.db). If null, falls back to central.
 * @param {number|null}  [params.userId]            - ID of the acting user.
 * @param {string}        params.action             - Short action label, e.g. 'LOGIN', 'CREATE_UNIT'.
 * @param {string}        params.module             - Module name, e.g. 'AUTH', 'UNIT_MGMT'.
 * @param {string}        params.recordType         - Entity type being acted on, e.g. 'USER', 'UNIT'.
 * @param {number|null}  [params.recordId]          - Primary key of the affected record.
 * @param {object|null}  [params.oldValues]         - Snapshot before the action.
 * @param {object|null}  [params.newValues]         - Snapshot after the action.
 * @param {string|null}  [params.ipAddress]         - Originating IP address.
 * @param {string|null}  [params.userAgent]         - Originating User-Agent string.
 * @param {boolean}      [params.isSuperAdminAction]- If true, also logs to global_audit_logs in central DB.
 * @param {string|null}  [params.sourceUnit]        - db_name of the unit (for global log context).
 */
const logAudit = async ({
  db            = null,   // unit DB pool (req.db) — if null, only logs to central
  userId        = null,
  action,
  module,
  recordType,
  recordId      = null,
  oldValues     = null,
  newValues     = null,
  ipAddress     = null,
  userAgent     = null,
  isSuperAdminAction = false,  // if true, also writes to global_audit_logs in central
  sourceUnit    = null,        // db_name of the unit (for global log context)
}) => {
  const oldJson = oldValues ? JSON.stringify(oldValues) : null;
  const newJson = newValues ? JSON.stringify(newValues) : null;

  // ── 1. Write to unit's audit_logs ────────────────────────────────────────────
  if (db) {
    try {
      await db.query(
        `INSERT INTO audit_logs
           (user_id, action, module, record_type, record_id, old_values, new_values, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, action, module, recordType, recordId, oldJson, newJson, ipAddress, userAgent]
      );
    } catch (err) {
      console.error('[AuditLogger] Failed to write unit audit log:', err.message);
    }
  }

  // ── 2. Also write to central global_audit_logs for super admin actions ────────
  if (isSuperAdminAction) {
    try {
      await centralPool.query(
        `INSERT INTO global_audit_logs
           (user_id, source_unit, action, module, record_type, record_id, old_values, new_values, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, sourceUnit || null, action, module, recordType, recordId, oldJson, newJson, ipAddress, userAgent]
      );
    } catch (err) {
      console.error('[AuditLogger] Failed to write global audit log:', err.message);
    }
  }

  // ── 3. Fallback — if neither db nor isSuperAdminAction, log to central ────────
  if (!db && !isSuperAdminAction) {
    try {
      await centralPool.query(
        `INSERT INTO global_audit_logs
           (user_id, source_unit, action, module, record_type, record_id, old_values, new_values, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, sourceUnit || 'unknown', action, module, recordType, recordId, oldJson, newJson, ipAddress, userAgent]
      );
    } catch (err) {
      console.error('[AuditLogger] Failed to write fallback audit log:', err.message);
    }
  }
};

/**
 * auditActor(req) → the { db, userId, isSuperAdminAction, sourceUnit } part of a
 * logAudit() call for the user making this request.
 *
 * Central users (super_admin / global_auditor) have ids from vms_central.users.
 * Writing those ids into a unit's audit_logs.user_id would point at an unrelated
 * unit user with the same id, so their actions go to the central
 * global_audit_logs instead, tagged with the unit they were managing.
 *
 * Usage: logAudit({ ...auditActor(req), action, module, recordType, ... })
 */
const auditActor = (req) => {
  if (req.user?.unit_db === 'central') {
    return {
      db:                 null,
      isSuperAdminAction: true,
      sourceUnit:         req.unitDbName || 'central',
      userId:             req.user.id,
    };
  }
  return { db: req.db, userId: req.user?.id ?? null };
};

module.exports = { logAudit, auditActor };
