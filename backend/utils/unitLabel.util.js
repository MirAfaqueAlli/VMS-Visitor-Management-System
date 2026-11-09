// backend/utils/unitLabel.util.js
'use strict';

const { centralPool } = require('../services/dbManager');

/**
 * A unit as visitors read it — "Unit 1, Bhubaneswar" (name, and city when known) — for
 * the Unit line of visitor emails and WhatsApp messages. Null when unknown. Never throws.
 * @param {number} unitId
 */
async function unitLabel(unitId) {
  if (!unitId) return null;
  try {
    const [[u]] = await centralPool.query('SELECT name, city FROM units WHERE id = ? LIMIT 1', [unitId]);
    return u ? [u.name, u.city].filter(Boolean).join(', ') : null;
  } catch {
    return null;
  }
}

module.exports = { unitLabel };
