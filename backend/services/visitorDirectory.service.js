// backend/services/visitorDirectory.service.js
'use strict';

/**
 * Looks a visitor up across every unit by mobile number. Used by the public
 * request form (returning visitor) and the visitor portal (first OTP sign-in of
 * a visitor that staff added, or who requested before accounts existed).
 */

const { queryAllUnits } = require('./dbManager');
const { normalisePhone } = require('./contactVerification.service');

/**
 * Searches all active unit databases for past visitor records matching the phone number.
 * Searches visit_requests first (most up-to-date), then fallback to visitors table.
 */
async function findExistingVisitorByPhone(phone) {
  const cleanPhone = normalisePhone(phone);
  if (!cleanPhone || cleanPhone.length !== 10) return null;

  // 1. Search visit_requests across all active unit databases
  const reqSql = `
    SELECT 
      vr.visitor_name,
      vr.visitor_phone,
      vr.visitor_email,
      vr.visitor_address,
      vr.company_name,
      v.full_name AS v_name,
      v.email AS v_email,
      v.address AS v_address,
      vr.created_at
    FROM visit_requests vr
    LEFT JOIN visitors v ON (vr.visitor_id = v.id OR vr.visitor_phone = v.phone)
    WHERE (
      vr.visitor_phone = ?
      OR vr.visitor_phone = ?
      OR REPLACE(REPLACE(REPLACE(vr.visitor_phone, ' ', ''), '-', ''), '+', '') = ?
      OR RIGHT(REPLACE(REPLACE(REPLACE(vr.visitor_phone, ' ', ''), '-', ''), '+', ''), 10) = ?
    )
    ORDER BY vr.created_at DESC
    LIMIT 1
  `;

  let bestRecord = null;
  try {
    const results = await queryAllUnits(reqSql, [phone, cleanPhone, cleanPhone, cleanPhone]);
    for (const res of results) {
      if (res.rows && res.rows.length > 0) {
        const row = res.rows[0];
        if (!bestRecord || new Date(row.created_at) > new Date(bestRecord.created_at)) {
          bestRecord = row;
        }
      }
    }
  } catch (err) {
    console.warn('[PublicAuth] findExistingVisitorByPhone visit_requests error:', err.message);
  }

  if (bestRecord) {
    const name = (bestRecord.v_name || bestRecord.visitor_name || '').trim();
    if (name) {
      return {
        visitor_name:    name,
        visitor_phone:   cleanPhone,
        visitor_email:   (bestRecord.v_email || bestRecord.visitor_email || '').trim(),
        visitor_address: (bestRecord.v_address || bestRecord.visitor_address || '').trim(),
        company_name:    (bestRecord.company_name || '').trim(),
      };
    }
  }

  // 2. Fallback: Search visitors table directly across active unit databases
  const visitorSql = `
    SELECT full_name, email, phone, address, created_at
    FROM visitors
    WHERE phone = ? OR phone LIKE ?
    ORDER BY created_at DESC
    LIMIT 1
  `;
  try {
    const vResults = await queryAllUnits(visitorSql, [cleanPhone, `%${cleanPhone}`]);
    let bestV = null;
    for (const res of vResults) {
      if (res.rows && res.rows.length > 0) {
        const row = res.rows[0];
        if (!bestV || new Date(row.created_at) > new Date(bestV.created_at)) {
          bestV = row;
        }
      }
    }
    if (bestV && bestV.full_name) {
      return {
        visitor_name:    bestV.full_name.trim(),
        visitor_phone:   cleanPhone,
        visitor_email:   (bestV.email || '').trim(),
        visitor_address: (bestV.address || '').trim(),
        company_name:    '',
      };
    }
  } catch (err) {
    console.warn('[PublicAuth] findExistingVisitorByPhone visitors table error:', err.message);
  }

  return null;
}

module.exports = { findExistingVisitorByPhone };
