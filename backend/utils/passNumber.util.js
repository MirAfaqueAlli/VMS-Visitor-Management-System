// backend/utils/passNumber.util.js
'use strict';

const crypto = require('crypto');

/**
 * Generates a candidate gate pass number in the format:
 *   VMS-{ORGCODE}-{YYYYMMDD}-{5-digit-zero-padded-random}
 *
 * Example: VMS-CTTK-20260514-00042
 *
 * Not guaranteed unique on its own — generateGatePass() checks it against
 * gate_passes and retries (pass_number is UNIQUE).
 *
 * @param {string} orgCode - The organization code (e.g. 'SBTQ'). Will be upper-cased.
 * @returns {string} A candidate gate pass number string.
 */
const generatePassNumber = (orgCode) => {
  if (!orgCode || typeof orgCode !== 'string') {
    throw new Error('generatePassNumber: orgCode must be a non-empty string.');
  }

  const code = orgCode.trim().toUpperCase();

  // YYYYMMDD in IST — the date security staff see on the pass
  const datePart = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).replace(/-/g, '');

  // 5-digit zero-padded random number (00000 – 99999) from a secure RNG
  const random = String(crypto.randomInt(0, 100000)).padStart(5, '0');

  return `VMS-${code}-${datePart}-${random}`;
};

module.exports = { generatePassNumber };
