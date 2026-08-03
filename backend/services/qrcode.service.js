// backend/services/qrcode.service.js
'use strict';

const QRCode  = require('qrcode');
const fs      = require('fs');
const path    = require('path');
const { signQRPayload } = require('../utils/qrToken.util');

const QR_DIR = path.join(__dirname, '..', 'uploads', 'qrcodes');

/**
 * Generates a signed QR code PNG file from a data object.
 *
 * Saves locally to uploads/qrcodes/<filename>.png (always).
 *
 * The QR encodes a compact HMAC-SHA256 signed token:
 *   <base64url(payload_json)>.<base64url(hmac_signature)>
 *
 * @param {object} data       - Data object to encode & sign.
 * @param {string} filename   - Base filename (without extension).
 * @returns {Promise<string>}  - Relative local path (uploads/qrcodes/<filename>.png)
 */
const generateQRCode = async (data, filename) => {
  // Ensure the output directory exists
  fs.mkdirSync(QR_DIR, { recursive: true });

  // Sign the payload — produces a tamper-proof compact token
  const signedToken = signQRPayload(data);

  const filePath     = path.join(QR_DIR, `${filename}.png`);
  const relativePath = `uploads/qrcodes/${filename}.png`;

  // Save locally (QRCode renders into a Buffer, then we write to disk)
  const qrBuffer = await QRCode.toBuffer(signedToken, {
    width: 300,
    errorCorrectionLevel: 'H',
    type: 'png',
  });

  fs.writeFileSync(filePath, qrBuffer);

  return relativePath;
};

module.exports = { generateQRCode };
