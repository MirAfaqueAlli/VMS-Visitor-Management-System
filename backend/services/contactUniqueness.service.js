// backend/services/contactUniqueness.service.js
// Email addresses and mobile numbers are unique across the WHOLE system — the
// central database and every unit database — not just inside one database.
// One person = one account: a sign-in, OTP or notification sent to an email /
// mobile always reaches exactly one user.
//
//   email → compared case-insensitively
//   phone → compared on its last 10 digits, so "+91 98765 43210", "098765 43210"
//           and "9876543210" are the same number
//
// Deleted users (deleted_at set) don't count — their contact details are free again.
// Deactivated UNITS do count: their users come back when the unit is reactivated.

const { centralPool, getPool, CENTRAL_DB_NAME } = require('./dbManager');

/** Digits only, last 10 (the national number for +91). '' when there is no phone. */
const phoneKey = (phone) => String(phone ?? '').replace(/\D/g, '').slice(-10);

const PHONE_SQL = "RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', ''), 10)";

/** Every database that holds user accounts: central + each provisioned unit. */
async function userDatabases() {
  const [units] = await centralPool.query(
    `SELECT name, db_name FROM units WHERE db_status IN ('ACTIVE', 'SUSPENDED')`
  );
  return [
    { pool: centralPool, label: 'the central administration', dbName: CENTRAL_DB_NAME },
    ...units.map((u) => ({ pool: getPool(u.db_name), label: u.name, dbName: u.db_name })),
  ];
}

/**
 * Finds an existing account that already uses this email or mobile number.
 *
 * @param {object} p
 * @param {string}  [p.email]
 * @param {string}  [p.phone]
 * @param {object}  [p.exclude]  the account being edited: { pool, id } — skipped
 * @returns {Promise<null | { field: 'email'|'phone', where: string }>}
 * @throws  when a database can't be checked (callers answer 503 — never "allowed")
 */
async function findContactConflict({ email, phone, exclude } = {}) {
  const emailKey = String(email ?? '').trim().toLowerCase();
  const phoneDigits = phoneKey(phone);
  if (!emailKey && !phoneDigits) return null;

  const dbs = await userDatabases();
  const results = await Promise.all(dbs.map(async (db) => {
    const skipSelf = exclude && exclude.pool === db.pool && exclude.id != null;
    try {
      const [rows] = await db.pool.query(
        `SELECT (? <> '' AND LOWER(email) = ?)            AS email_hit,
                (? <> '' AND ${PHONE_SQL} = ?)              AS phone_hit
           FROM users
          WHERE deleted_at IS NULL
            AND ((? <> '' AND LOWER(email) = ?) OR (? <> '' AND ${PHONE_SQL} = ?))
            ${skipSelf ? 'AND id <> ?' : ''}
          LIMIT 1`,
        [emailKey, emailKey, phoneDigits, phoneDigits,
         emailKey, emailKey, phoneDigits, phoneDigits,
         ...(skipSelf ? [exclude.id] : [])]
      );
      if (!rows.length) return null;
      return { field: rows[0].email_hit ? 'email' : 'phone', where: db.label };
    } catch (err) {
      // A unit whose database was never created has no users to clash with
      if (err.code === 'ER_BAD_DB_ERROR') return null;
      console.error(`[ContactUniqueness] Could not check ${db.dbName}:`, err.message);
      throw new Error('CONTACT_CHECK_FAILED');
    }
  }));

  // Report an email clash before a phone clash (it's the sign-in identifier)
  return results.find((r) => r?.field === 'email') || results.find(Boolean) || null;
}

/** Ready-made API message for a conflict found by findContactConflict(). */
function conflictMessage(conflict) {
  const what = conflict.field === 'email' ? 'This email address' : 'This mobile number';
  return `${what} is already used by another account in ${conflict.where}. Each person can have only one account — use a different ${conflict.field === 'email' ? 'email' : 'number'}.`;
}

/**
 * Express helper: sends 409 (taken) or 503 (couldn't check) and returns true when
 * the request must stop; returns false when the contact details are free.
 */
async function rejectIfContactTaken(res, sendError, params) {
  try {
    const conflict = await findContactConflict(params);
    if (!conflict) return false;
    sendError(res, conflictMessage(conflict), 409);
    return true;
  } catch {
    sendError(res, 'Could not confirm that the email and mobile number are unused. Please try again.', 503);
    return true;
  }
}

module.exports = { findContactConflict, conflictMessage, rejectIfContactTaken, phoneKey };
