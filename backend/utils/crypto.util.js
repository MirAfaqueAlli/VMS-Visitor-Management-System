// backend/utils/crypto.util.js
'use strict';

/**
 * VMS Cryptography Utility
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides two independent capabilities:
 *
 *  1. OTP Hashing (SHA-256)
 *     - `hashOtp(otp)`   → deterministic hash used for storing & comparing OTPs
 *     - No key needed — SHA-256 is fine for short-lived 6-digit OTPs because:
 *       a) OTPs expire in minutes, making brute-force impractical in that window
 *       b) The OTP is already rate-limited and single-use
 *
 *  2. Field Encryption (AES-256-GCM)
 *     - `encryptField(plaintext)` → encrypted hex string  (for INSERT)
 *     - `decryptField(stored)`    → original plaintext   (for SELECT)
 *     - Used for: government ID numbers, Aadhaar, passport numbers
 *     - Requires DB_ENCRYPTION_KEY in .env (64 hex chars = 32 bytes)
 *
 * SETUP:
 *   Generate a key once and add to .env:
 *     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 *   DB_ENCRYPTION_KEY=<64-hex-char-string>
 */

const crypto = require('crypto');

// ── OTP Hashing ───────────────────────────────────────────────────────────────

/**
 * Returns a SHA-256 hex digest of the given OTP string.
 * Used before storing OTPs in the DB and before comparing at verification.
 *
 * @param {string} otp - Raw OTP code (e.g. "482917")
 * @returns {string}   - 64-char hex string
 */
const hashOtp = (otp) =>
  crypto.createHash('sha256').update(String(otp)).digest('hex');

// ── AES-256-GCM Field Encryption ──────────────────────────────────────────────

const ALGO = 'aes-256-gcm';
const KEY_HEX = (process.env.DB_ENCRYPTION_KEY || '').trim();

// Warn at startup if key is missing or wrong length
if (!KEY_HEX || KEY_HEX.length !== 64) {
  console.warn(
    '[CryptoUtil] WARNING: DB_ENCRYPTION_KEY is not set or is not 64 hex characters. ' +
    'Field encryption will be DISABLED — sensitive ID fields will be stored unencrypted. ' +
    'Generate a key with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
}

const ENCRYPTION_ENABLED = KEY_HEX.length === 64;

let ENCRYPTION_KEY;
if (ENCRYPTION_ENABLED) {
  ENCRYPTION_KEY = Buffer.from(KEY_HEX, 'hex');
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Format: `enc:<ivHex>:<authTagHex>:<ciphertextHex>`
 * The "enc:" prefix lets us detect & safely skip already-encrypted values.
 *
 * @param {string|null} plaintext
 * @returns {string|null} - Encrypted string or null if input is null/empty
 */
const encryptField = (plaintext) => {
  if (plaintext === null || plaintext === undefined || plaintext === '') return plaintext;

  // If encryption is disabled, return plaintext (fallback — key not set)
  if (!ENCRYPTION_ENABLED) return plaintext;

  // Avoid double-encrypting
  if (typeof plaintext === 'string' && plaintext.startsWith('enc:')) return plaintext;

  const iv         = crypto.randomBytes(12);                            // 96-bit IV for GCM
  const cipher     = crypto.createCipheriv(ALGO, ENCRYPTION_KEY, iv);
  const encrypted  = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag    = cipher.getAuthTag();                               // 128-bit authentication tag

  return `enc:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
};

/**
 * Decrypts a value produced by `encryptField()`.
 * Safely returns the input unchanged if:
 *   - The value is null/undefined/empty
 *   - The value does not start with "enc:" (i.e., was stored before encryption was enabled)
 *   - Decryption fails for any reason (logs a warning, returns null)
 *
 * @param {string|null} stored
 * @returns {string|null} - Decrypted plaintext or null on failure
 */
const decryptField = (stored) => {
  if (stored === null || stored === undefined || stored === '') return stored;
  if (typeof stored !== 'string' || !stored.startsWith('enc:')) {
    // Value was stored before encryption was enabled — return as-is
    return stored;
  }

  if (!ENCRYPTION_ENABLED) {
    console.warn('[CryptoUtil] Cannot decrypt — DB_ENCRYPTION_KEY is not set.');
    return null;
  }

  try {
    const parts = stored.split(':');
    // Expected: ["enc", ivHex, authTagHex, ciphertextHex]
    if (parts.length !== 4) throw new Error('Invalid encrypted format');

    const [, ivHex, authTagHex, ciphertextHex] = parts;
    const iv         = Buffer.from(ivHex, 'hex');
    const authTag    = Buffer.from(authTagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGO, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    console.error('[CryptoUtil] decryptField failed:', err.message);
    return null;
  }
};

/**
 * Decrypts an array of objects, decrypting a specific field in each.
 *
 * @param {object[]} rows
 * @param {string[]} fields - Field names to decrypt in each row
 * @returns {object[]} Rows with the specified fields decrypted
 */
const decryptRows = (rows, fields) => {
  if (!Array.isArray(rows)) return rows;
  return rows.map(row => {
    const out = { ...row };
    for (const field of fields) {
      if (out[field] !== undefined) {
        out[field] = decryptField(out[field]);
      }
    }
    return out;
  });
};

module.exports = {
  hashOtp,
  encryptField,
  decryptField,
  decryptRows,
  isEncryptionEnabled: () => ENCRYPTION_ENABLED,
};
