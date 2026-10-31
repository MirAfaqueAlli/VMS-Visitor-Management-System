// backend/services/qrcode.service.js
'use strict';

const QRCode           = require('qrcode');
const { signQRPayload } = require('../utils/qrToken.util');
const { uploadToS3, getSignedFileUrl } = require('../utils/s3.util');

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

/**
 * A gate pass's QR as an image the browser can show: the stored S3 image (as a
 * short-lived signed link) when there is one, otherwise drawn on the fly from the
 * pass's own data (gate_passes.qr_code_data). Passes issued without S3 — no AWS
 * credentials, e.g. a dev machine — still get a scannable QR.
 *
 * @param {{ qr_code_path?: string|null, qr_code_data?: string|null }} pass
 * @returns {Promise<string|null>} https link, data:image/png URL, or null
 */
const qrImageForPass = async (pass) => {
  const signed = await getSignedFileUrl(pass?.qr_code_path);
  if (signed) return signed;
  if (!pass?.qr_code_data) return null;
  try {
    return await QRCode.toDataURL(signQRPayload(JSON.parse(pass.qr_code_data)), { width: 300, margin: 1, errorCorrectionLevel: 'H' });
  } catch (err) {
    console.warn('[QRCodeService] could not draw the QR:', err.message);
    return null;
  }
};

module.exports = { generateQRCode, qrImageForPass };
