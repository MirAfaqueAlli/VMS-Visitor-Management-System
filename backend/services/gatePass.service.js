// backend/services/gatePass.service.js
'use strict';

const { centralPool, getPool } = require('./dbManager');
const { generatePassNumber }   = require('../utils/passNumber.util');
const { generateQRCode }       = require('./qrcode.service');
const { logAudit }             = require('../utils/auditLogger.util');

/**
 * Generates a gate pass for the given visit request.
 * Idempotent — if a pass already exists for this visit_request_id it is returned as-is.
 *
 * The function resolves the correct unit DB by:
 *   1. Preferring the explicitly passed `db` pool (from req.db), OR
 *   2. Looking up the visit request's unit_id in vms_central to find the db_name.
 *
 * @param {number} visitRequestId
 * @param {number} generatedByUserId
 * @param {object} [db]  — optional: the unit's mysql2/promise pool (req.db).
 *                         If not passed, the service resolves it via centralPool.
 * @returns {Promise<{ pass_number: string, qr_code_path: string, gate_pass_id: number }>}
 */
const generateGatePass = async (visitRequestId, generatedByUserId, db = null) => {
  // ── 1. Resolve which DB pool to use ────────────────────────────────────────
  let unitDb = db;

  if (!unitDb) {
    // Fallback: look up the unit_id from centralPool → get db_name
    const [vrMeta] = await centralPool.query(
      `SELECT vr.unit_id, u.db_name
       FROM visit_requests vr
       JOIN units u ON u.id = vr.unit_id
       WHERE vr.id = ?`,
      [visitRequestId]
    );
    if (!vrMeta.length) throw new Error(`Visit request ${visitRequestId} not found in any unit.`);
    unitDb = getPool(vrMeta[0].db_name);
  }

  // ── 2. Idempotency check ────────────────────────────────────────────────────
  const [existingRows] = await unitDb.query(
    `SELECT id, pass_number, qr_code_path FROM gate_passes WHERE visit_request_id = ? LIMIT 1`,
    [visitRequestId]
  );
  if (existingRows.length) {
    const ex = existingRows[0];
    return { pass_number: ex.pass_number, qr_code_path: ex.qr_code_path, gate_pass_id: ex.id };
  }

  // ── 3. Fetch visit request for QR payload ──────────────────────────────────
  const [vrRows] = await unitDb.query(
    `SELECT vr.*,
            COALESCE(vr.visitor_name, v.full_name, ru.full_name, 'Unknown') AS resolved_visitor_name
     FROM visit_requests vr
     LEFT JOIN visitors v  ON v.id  = vr.visitor_id
     LEFT JOIN users    ru ON ru.id = vr.requester_user_id
     WHERE vr.id = ?`,
    [visitRequestId]
  );
  if (!vrRows.length) throw new Error(`Visit request ${visitRequestId} not found.`);
  const request = vrRows[0];

  // ── 4. Resolve unit code for pass number prefix ────────────────────────────
  let unitCode = 'VMS';
  try {
    const [unitRows] = await centralPool.query(
      'SELECT code FROM units WHERE id = ? LIMIT 1', [request.unit_id]
    );
    if (unitRows.length) unitCode = unitRows[0].code;
  } catch (_) {} // non-fatal

  // ── 5. Generate pass number + QR code ─────────────────────────────────────
  const passNumber = generatePassNumber(unitCode);
  const qrData     = {
    pass_number:      passNumber,
    visit_request_id: visitRequestId,
    visit_date:       request.visit_date,
    visitor_name:     request.resolved_visitor_name,
  };
  const qrCodePath = await generateQRCode(qrData, passNumber);

  // ── 6. Persist to gate_passes ─────────────────────────────────────────────
  const [insertResult] = await unitDb.query(
    `INSERT INTO gate_passes
       (visit_request_id, pass_number, qr_code_data, qr_code_path, status, issued_by, issued_at, created_at)
     VALUES (?, ?, ?, ?, 'ISSUED', ?, NOW(), NOW())`,
    [visitRequestId, passNumber, JSON.stringify(qrData), qrCodePath, generatedByUserId]
  );
  const gate_pass_id = insertResult.insertId;

  // ── 7. Audit log (fire-and-forget) ─────────────────────────────────────────
  logAudit({
    db:        unitDb,
    userId:    generatedByUserId,
    action:    'GENERATE_PASS',
    module:    'GATE',
    recordType: 'GATE_PASS',
    recordId:  gate_pass_id,
  }).catch(() => {});

  return { pass_number: passNumber, qr_code_path: qrCodePath, gate_pass_id };
};

module.exports = { generateGatePass };
