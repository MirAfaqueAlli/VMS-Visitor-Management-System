// backend/utils/qrToken.util.js
'use strict';

/**
 * QR Token — HMAC-SHA256 Signing Utility
 * ─────────────────────────────────────────────────────────────────────────────
 * Format encoded into the QR image:
 *   <base64url(payload_json)>.<base64url(hmac_sha256_signature)>
 *
 * This prevents:
 *   • Payload tampering (any field change invalidates the signature)
 *   • Forgery (attacker cannot create a valid signature without QR_SECRET)
 *   • Replay attacks — payload includes pass_number which is already unique
 *     and tied to a single ISSUED/USED gate_pass row
 *
 * The QR image itself stays a standard PNG scannable by any QR reader, but
 * the text it encodes is a signed token rather than raw JSON.
 */

const crypto = require('crypto');

const QR_SECRET = process.env.QR_SECRET;

if (!QR_SECRET) {
  console.warn('[qrToken] WARNING: QR_SECRET is not set in environment. QR signing will fail.');
}

/** Base64url-safe encoder (no padding, + → -, / → _) */
const toB64 = (str) => Buffer.from(str).toString('base64url');

/** Base64url-safe decoder */
const fromB64 = (str) => Buffer.from(str, 'base64url').toString('utf8');

/**
 * Compute HMAC-SHA256 of a string and return as base64url.
 * @param {string} data
 * @returns {string}
 */
const hmac = (data) => {
  return crypto
    .createHmac('sha256', QR_SECRET)
    .update(data)
    .digest('base64url');
};

/**
 * Sign a payload object and return a compact signed token.
 *
 * @param {object} payload   - Plain object to encode (e.g. { pass_number, visit_request_id, ... })
 * @param {number} [ttlSecs] - Optional: embed an exp timestamp (seconds from epoch).
 *                             If omitted, no expiry is embedded in the token itself
 *                             (gate pass DB expiry window is still enforced separately).
 * @returns {string}  "<b64url_payload>.<b64url_signature>"
 */
const signQRPayload = (payload, ttlSecs = null) => {
  if (!QR_SECRET) throw new Error('QR_SECRET is not configured.');

  const dataWithMeta = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),           // issued-at (Unix seconds)
    ...(ttlSecs ? { exp: Math.floor(Date.now() / 1000) + ttlSecs } : {}),
  };

  const encodedPayload = toB64(JSON.stringify(dataWithMeta));
  const signature      = hmac(encodedPayload);

  return `${encodedPayload}.${signature}`;
};

/**
 * Verify and decode a signed QR token.
 *
 * @param {string} token  - The token string read from the QR scan.
 * @returns {{ valid: boolean, payload?: object, error?: string }}
 */
const verifyQRToken = (token) => {
  try {
    if (!QR_SECRET) return { valid: false, error: 'QR_SECRET is not configured on the server.' };
    if (typeof token !== 'string') return { valid: false, error: 'Invalid token format.' };

    // Strip whitespace that some scanners inject
    const clean = token.trim();

    // ── Legacy plain-JSON fallback ─────────────────────────────────────────
    // If the token starts with '{' it is an old unsigned payload (pre-signing era).
    // Reject it — do NOT silently accept unsigned QRs.
    if (clean.startsWith('{')) {
      return {
        valid:   false,
        error:   'QR code is not cryptographically signed. Please regenerate the gate pass.',
      };
    }

    // Split into payload + signature
    const dotIdx = clean.lastIndexOf('.');
    if (dotIdx === -1) return { valid: false, error: 'Malformed QR token — missing signature.' };

    const encodedPayload = clean.slice(0, dotIdx);
    const receivedSig    = clean.slice(dotIdx + 1);

    // ── 1. Constant-time signature comparison (prevents timing attacks) ────
    const expectedSig = hmac(encodedPayload);
    const sigBuffer   = Buffer.from(receivedSig,  'base64url');
    const expBuffer   = Buffer.from(expectedSig,  'base64url');

    if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
      return { valid: false, error: 'QR signature mismatch — token has been tampered with.' };
    }

    // ── 2. Decode payload ──────────────────────────────────────────────────
    let payload;
    try {
      payload = JSON.parse(fromB64(encodedPayload));
    } catch {
      return { valid: false, error: 'QR payload is not valid JSON.' };
    }

    // ── 3. Optional: check embedded expiry ────────────────────────────────
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return { valid: false, error: 'QR token has expired (embedded expiry).' };
    }

    return { valid: true, payload };

  } catch (err) {
    return { valid: false, error: `Token verification error: ${err.message}` };
  }
};

module.exports = { signQRPayload, verifyQRToken };
