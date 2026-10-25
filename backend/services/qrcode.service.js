// backend/services/qrcode.service.js
'use strict';

const QRCode           = require('qrcode');
const { signQRPayload } = require('../utils/qrToken.util');
const { uploadToS3 }   = require('../utils/s3.util');

/**
 * Generates a signed QR code PNG and uploads it to AWS S3.
 *
 * The QR encodes a compact HMAC-SHA256 signed token:
 *   <base64url(payload_json)>.<base64url(hmac_signature)>
 *
 * @param {object} data       - Data object to encode & sign.
 * @param {string} filename   - Base filename (without extension).
 * @returns {Promise<string>} - Public S3 URL of the uploaded QR code PNG.
 */
const generateQRCode = async (data, filename) => {
  // Sign the payload — produces a tamper-proof compact token
  const signedToken = signQRPayload(data);

  // Render QR code into a PNG Buffer (no local disk write)
  const qrBuffer = await QRCode.toBuffer(signedToken, {
    width: 300,
    errorCorrectionLevel: 'H',
    type: 'png',
  });

  // Upload to S3 and return the public URL
  const url = await uploadToS3({
    buffer:   qrBuffer,
    mimeType: 'image/png',
    folder:   'qrcodes',
    filename: `${filename}.png`,
  });

  return url;
};

module.exports = { generateQRCode };
