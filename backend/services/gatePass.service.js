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
 * @param {number} visitRequestId
 * @param {number} generatedByUserId
 * @param {object} [db]  — optional: the unit's mysql2/promise pool (req.db).
 * @returns {Promise<{ pass_number: string, qr_code_path: string, gate_pass_id: number }>}
 */
const generateGatePass = async (visitRequestId, generatedByUserId, db = null) => {
  // ── 1. Resolve which DB pool to use ────────────────────────────────────────
  let unitDb = db;

  if (!unitDb) {
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
    `SELECT id, pass_number, qr_code_path, qr_code_data FROM gate_passes WHERE visit_request_id = ? LIMIT 1`,
    [visitRequestId]
  );
  if (existingRows && existingRows.length) {
    const ex = existingRows[0];
    return {
      pass_number:  ex.pass_number,
      qr_code_path: ex.qr_code_path,
      qr_code_data: ex.qr_code_data,
      gate_pass_id: ex.id,
    };
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

  // ── 5–6. Pick a free pass number, generate QR, persist ─────────────────────
  // 5 random digits per unit per day can collide and pass_number is UNIQUE, so skip
  // numbers already taken and retry if a parallel request grabs the same one.
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const passNumber = generatePassNumber(unitCode);
    const [taken] = await unitDb.query(
      'SELECT 1 FROM gate_passes WHERE pass_number = ? LIMIT 1', [passNumber]
    );
    if (taken.length) continue;

    const qrData = {
      pass_number:      passNumber,
      visit_request_id: visitRequestId,
      visit_date:       request.visit_date,
      visitor_name:     request.resolved_visitor_name,
    };
    // The pass is issued at once; its QR image is stored in S3 just after (below), so
    // approving doesn't wait for the upload. Until then — or if storage is unavailable —
    // every screen, email and PDF draws the same QR from qr_code_data (qrImageForPass,
    // gatePassQrAttachment), and the gate can always check the visitor in by pass number.
    const qrCodePath = null;

    let insertResult;
    try {
      [insertResult] = await unitDb.query(
        `INSERT INTO gate_passes
           (visit_request_id, pass_number, qr_code_data, qr_code_path, status, issued_by, issued_at, created_at)
         VALUES (?, ?, ?, ?, 'ISSUED', ?, NOW(), NOW())`,
        [visitRequestId, passNumber, JSON.stringify(qrData), qrCodePath, generatedByUserId]
      );
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
      // visit_request_id is UNIQUE too: if a parallel call already created this
      // visit's pass, return that one; otherwise the pass number collided — retry.
      const [existing] = await unitDb.query(
        'SELECT id, pass_number, qr_code_path, qr_code_data FROM gate_passes WHERE visit_request_id = ? LIMIT 1',
        [visitRequestId]
      );
      if (existing.length) {
        return {
          pass_number: existing[0].pass_number, qr_code_path: existing[0].qr_code_path,
          qr_code_data: existing[0].qr_code_data, gate_pass_id: existing[0].id,
        };
      }
      continue;
    }
    const gate_pass_id = insertResult.insertId;

    // ── QR image → S3 in the background (not awaited) ───────────────────────
    generateQRCode(qrData, passNumber)
      .then((path) => unitDb.query('UPDATE gate_passes SET qr_code_path = ? WHERE id = ? AND qr_code_path IS NULL', [path, gate_pass_id]))
      .catch((qrErr) => console.warn(`[GatePassService] Pass ${passNumber}: QR image not stored (${qrErr.message}) — `
        + 'it is drawn from the pass data instead. Check AWS credentials and AWS_S3_BUCKET.'));

    // ── 7. Audit log (fire-and-forget) ───────────────────────────────────────
    logAudit({
      db:        unitDb,
      userId:    generatedByUserId,
      action:    'GENERATE_PASS',
      module:    'GATE',
      recordType: 'GATE_PASS',
      recordId:  gate_pass_id,
    }).catch(() => {});

    return { pass_number: passNumber, qr_code_path: qrCodePath, qr_code_data: JSON.stringify(qrData), gate_pass_id };
  }

  throw new Error(`Could not allocate a unique gate pass number after ${MAX_ATTEMPTS} attempts.`);
};

module.exports = { generateGatePass };
