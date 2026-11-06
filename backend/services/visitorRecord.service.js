// backend/services/visitorRecord.service.js
'use strict';

/**
 * What the system already knows about a visit's visitor, for the gate: their ID
 * proof and photo, wherever they were last recorded. Taken in this order:
 *
 *   ID proof  the request → their visitor-portal profile → their saved ID
 *             (visitor_documents) → their last check-in
 *   Photo     the request → their portal profile → their last check-in photo
 *
 * The ID number comes back decrypted — callers mask it for roles that mustn't see it.
 */

const { centralPool, getPool } = require('./dbManager');
const { decryptField } = require('../utils/crypto.util');

const PHONE_SQL = "RIGHT(REGEXP_REPLACE(COALESCE(%s, ''), '[^0-9]', ''), 10)";
const last10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);

/**
 * @param {object} db       — the unit pool the request lives in
 * @param {object} request  — visit_requests row (id, visitor_id, visitor_phone, id_proof_*, visitor_photo_path)
 * @returns {Promise<{ id_proof_type, id_proof_number, id_proof_source, photo_path, photo_source, last_check_in_at }>}
 */
async function visitorOnRecord(db, request) {
  const out = {
    id_proof_type: null, id_proof_number: null, id_proof_source: null,
    photo_path: null, photo_source: null, last_check_in_at: null,
  };
  const setId = (type, encrypted, source) => {
    if (out.id_proof_type || !type || !encrypted) return;
    const number = decryptField(encrypted);
    if (number) Object.assign(out, { id_proof_type: type, id_proof_number: number, id_proof_source: source });
  };
  const setPhoto = (path, source) => {
    if (!out.photo_path && path) Object.assign(out, { photo_path: path, photo_source: source });
  };

  setId(request.id_proof_type, request.id_proof_number, 'request');
  setPhoto(request.visitor_photo_path, 'request');

  const phone = last10(request.visitor_phone);
  if (phone.length !== 10) return out;

  try {
    if (!out.id_proof_type || !out.photo_path) {
      const [acc] = await centralPool.query(
        'SELECT id_proof_type, id_proof_number, photo_path FROM visitor_accounts WHERE phone = ? AND is_active = 1 LIMIT 1', [phone]
      );
      if (acc[0]) {
        setId(acc[0].id_proof_type, acc[0].id_proof_number, 'profile');
        setPhoto(acc[0].photo_path, 'profile');
      }
    }

    // Their check-ins in this unit (newest first) — the last one is shown to security
    const [logs] = await db.query(
      `SELECT vl.id_verified_type, vl.id_verified_number, vl.visitor_photo_path, vl.check_in_at
         FROM visit_logs vl
         JOIN visit_requests vr ON vr.id = vl.visit_request_id
        WHERE ${PHONE_SQL.replace('%s', 'vr.visitor_phone')} = ? AND vr.id <> ?
        ORDER BY vl.check_in_at DESC LIMIT 5`,
      [phone, request.id]
    );
    out.last_check_in_at = logs[0]?.check_in_at || null;

    if (!out.id_proof_type) {
      const [docs] = await db.query(
        `SELECT d.id_type, d.id_number
           FROM visitor_documents d
           JOIN visitors v ON v.id = d.visitor_id
          WHERE v.id = ? OR ${PHONE_SQL.replace('%s', 'v.phone')} = ?
          ORDER BY d.is_primary DESC, d.created_at DESC LIMIT 1`,
        [request.visitor_id || 0, phone]
      );
      if (docs[0]) setId(docs[0].id_type, docs[0].id_number, 'previous_visit');
    }
    for (const l of logs) {
      setId(l.id_verified_type, l.id_verified_number, 'previous_visit');
      setPhoto(l.visitor_photo_path, 'previous_visit');
    }
  } catch (err) {
    console.warn('[VisitorRecord] lookup failed:', err.message);   // the gate still works without it
  }
  return out;
}

/**
 * The ID proof and photo on record for a mobile number, before any request exists
 * (the staff "new request" lookup): their portal profile, then this unit's records,
 * then every other unit's.
 *
 * @param {string} phone
 * @param {object} db      — the unit pool the request is being made in
 * @param {string} dbName  — its DB name (skipped when looking at the other units)
 */
async function visitorRecordByPhone(phone, db, dbName) {
  const probe = { id: 0, visitor_phone: phone };
  const rec = await visitorOnRecord(db, probe);
  if (rec.id_proof_type && rec.photo_path) return rec;
  try {
    const [units] = await centralPool.query("SELECT db_name FROM units WHERE is_active = 1 AND db_status = 'ACTIVE'");
    for (const u of units) {
      if (u.db_name === dbName) continue;
      const other = await visitorOnRecord(getPool(u.db_name), probe);
      if (!rec.id_proof_type && other.id_proof_type) {
        Object.assign(rec, { id_proof_type: other.id_proof_type, id_proof_number: other.id_proof_number, id_proof_source: other.id_proof_source });
      }
      if (!rec.photo_path && other.photo_path) Object.assign(rec, { photo_path: other.photo_path, photo_source: other.photo_source });
      if (rec.id_proof_type && rec.photo_path) break;
    }
  } catch (err) {
    console.warn('[VisitorRecord] other units lookup failed:', err.message);
  }
  return rec;
}

module.exports = { visitorOnRecord, visitorRecordByPhone };
