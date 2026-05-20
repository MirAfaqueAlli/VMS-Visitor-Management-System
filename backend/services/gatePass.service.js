// backend/services/gatePass.service.js
'use strict';

const db = require('../db');
const { generatePassNumber } = require('../utils/passNumber.util');
const { generateQRCode } = require('./qrcode.service');
const { logAudit } = require('../utils/auditLogger.util');

/**
 * Generates a gate pass for the given visit request.
 * Idempotent — if a pass already exists it is returned as-is.
 *
 * @param {number} visitRequestId
 * @param {number} generatedByUserId
 * @returns {Promise<{ pass_number: string, qr_code_path: string, gate_pass_id: number }>}
 */
const generateGatePass = async (visitRequestId, generatedByUserId) => {
  // 1. Idempotency check — return existing pass if already generated
  const [existingRows] = await db.query(
    `SELECT id, pass_number, qr_code_path FROM gate_passes WHERE visit_request_id = ? LIMIT 1`,
    [visitRequestId]
  );
  if (existingRows.length) {
    const ex = existingRows[0];
    return { pass_number: ex.pass_number, qr_code_path: ex.qr_code_path, gate_pass_id: ex.id };
  }

  // 2. Fetch visit request with org code + visitor info for QR payload
  const [vrRows] = await db.query(
    `SELECT vr.*,
            o.code  AS org_code,
            COALESCE(v.full_name,  ru.full_name) AS visitor_name,
            COALESCE(v.email,      ru.email)      AS visitor_email
     FROM visit_requests vr
     JOIN organizations o  ON o.id  = vr.organization_id
     LEFT JOIN visitors  v  ON v.id  = vr.visitor_id
     LEFT JOIN users     ru ON ru.id = vr.requester_user_id
     WHERE vr.id = ?`,
    [visitRequestId]
  );
  if (!vrRows.length) throw new Error(`Visit request ${visitRequestId} not found.`);
  const request = vrRows[0];

  // 3. Generate pass number + QR code
  const passNumber  = generatePassNumber(request.org_code);
  const qrData      = {
    pass_number:      passNumber,
    visit_request_id: visitRequestId,
    visit_date:       request.visit_date,
    visitor_name:     request.visitor_name || 'Unknown',
  };
  const qrCodePath  = await generateQRCode(qrData, passNumber);

  // 4. Persist to gate_passes
  const [insertResult] = await db.query(
    `INSERT INTO gate_passes
       (visit_request_id, pass_number, qr_code_data, qr_code_path, status, issued_by, issued_at, created_at)
     VALUES (?, ?, ?, ?, 'ISSUED', ?, NOW(), NOW())`,
    [visitRequestId, passNumber, JSON.stringify(qrData), qrCodePath, generatedByUserId]
  );
  const gate_pass_id = insertResult.insertId;

  // 5. Audit log (fire-and-forget — don't let audit failures break the flow)
  logAudit({
    userId:     generatedByUserId,
    action:     'GENERATE_PASS',
    module:     'GATE',
    recordType: 'GATE_PASS',
    recordId:   gate_pass_id,
  }).catch(() => {});

  return { pass_number: passNumber, qr_code_path: qrCodePath, gate_pass_id };
};

module.exports = { generateGatePass };
