// backend/services/qrcode.service.js
'use strict';

const QRCode = require('qrcode');
const fs     = require('fs');
const path   = require('path');
const { signQRPayload } = require('../utils/qrToken.util');

const QR_DIR = path.join(__dirname, '..', 'uploads', 'qrcodes');

/**
 * Generates a signed QR code PNG file from a data object.
 *
 * The QR encodes a compact HMAC-SHA256 signed token:
 *   <base64url(payload_json)>.<base64url(hmac_signature)>
 *
 * This prevents forgery — any modification to the payload
 * (visitor name, pass number, etc.) invalidates the signature.
 *
 * @param {object} data       - The data object to encode and sign.
 * @param {string} filename   - Base filename (without extension) for the PNG.
 * @returns {Promise<string>} - Relative file path: uploads/qrcodes/{filename}.png
 */
const generateQRCode = async (data, filename) => {
  // Ensure the output directory exists
  fs.mkdirSync(QR_DIR, { recursive: true });

  // Sign the payload — produces a tamper-proof compact token
  const signedToken = signQRPayload(data);

  const filePath = path.join(QR_DIR, `${filename}.png`);

  await QRCode.toFile(filePath, signedToken, {
    width: 300,
    errorCorrectionLevel: 'H',
  });

  // Return a normalised relative path using forward slashes
  return `uploads/qrcodes/${filename}.png`;
};

module.exports = { generateQRCode };
