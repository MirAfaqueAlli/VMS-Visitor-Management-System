// backend/utils/auditLogger.util.js
'use strict';

const db = require('../db');

/**
 * Inserts an audit log entry into the audit_logs table.
 * This function is intentionally fire-and-forget safe — it will NEVER throw.
 *
 * @param {object} params
 * @param {number|null}  params.userId      - ID of the acting user (null for system actions).
 * @param {string}       params.action      - Short action label, e.g. 'LOGIN', 'CHANGE_PASSWORD'.
 * @param {string}       params.module      - Module name, e.g. 'AUTH', 'VISITOR'.
 * @param {string}       params.recordType  - The entity type being acted on, e.g. 'USER', 'VISIT'.
 * @param {number|null}  [params.recordId]  - The primary key of the affected record.
 * @param {object|null}  [params.oldValues] - Snapshot of the record before the action.
 * @param {object|null}  [params.newValues] - Snapshot of the record after the action.
 * @param {string|null}  [params.ipAddress] - Originating IP address.
 * @param {string|null}  [params.userAgent] - Originating User-Agent string.
 */
const logAudit = async ({
  userId = null,
  action,
  module,
  recordType,
  recordId = null,
  oldValues = null,
  newValues = null,
  ipAddress = null,
  userAgent = null,
}) => {
  try {
    await db.query(
      `INSERT INTO audit_logs
        (user_id, action, module, record_type, record_id, old_values, new_values, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        action,
        module,
        recordType,
        recordId,
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
        ipAddress,
        userAgent,
      ]
    );
  } catch (err) {
    // Audit logging must never crash the application.
    console.error('[AuditLogger] Failed to write audit log:', err.message);
  }
};

module.exports = { logAudit };
