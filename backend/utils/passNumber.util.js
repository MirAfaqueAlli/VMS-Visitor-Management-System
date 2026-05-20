// backend/utils/passNumber.util.js
'use strict';

/**
 * Generates a unique gate pass number in the format:
 *   VMS-{ORGCODE}-{YYYYMMDD}-{5-digit-zero-padded-random}
 *
 * Example: VMS-CTTK-20260514-00042
 *
 * @param {string} orgCode - The organization code (e.g. 'SBTQ'). Will be upper-cased.
 * @returns {string} A unique gate pass number string.
 */
const generatePassNumber = (orgCode) => {
  if (!orgCode || typeof orgCode !== 'string') {
    throw new Error('generatePassNumber: orgCode must be a non-empty string.');
  }

  const code = orgCode.trim().toUpperCase();

  // Build YYYYMMDD date segment from current UTC date
  const now = new Date();
  const year  = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day   = String(now.getUTCDate()).padStart(2, '0');
  const datePart = `${year}${month}${day}`;

  // 5-digit zero-padded random number (00000 – 99999)
  const random = String(Math.floor(Math.random() * 100000)).padStart(5, '0');

  return `VMS-${code}-${datePart}-${random}`;
};

module.exports = { generatePassNumber };
