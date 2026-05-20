// backend/services/qrcode.service.js
'use strict';

const QRCode = require('qrcode');
const fs     = require('fs');
const path   = require('path');

const QR_DIR = path.join(__dirname, '..', 'uploads', 'qrcodes');

/**
 * Generates a QR code PNG file from a data object.
 *
 * @param {object} data       - The data object to encode. Will be JSON-stringified.
 * @param {string} filename   - Base filename (without extension) for the PNG.
 * @returns {Promise<string>} - Relative file path: uploads/qrcodes/{filename}.png
 */
const generateQRCode = async (data, filename) => {
  // Ensure the output directory exists
  fs.mkdirSync(QR_DIR, { recursive: true });

  const jsonString = JSON.stringify(data);
  const filePath   = path.join(QR_DIR, `${filename}.png`);

  await QRCode.toFile(filePath, jsonString, {
    width: 300,
    errorCorrectionLevel: 'H',
  });

  // Return a normalised relative path using forward slashes
  return `uploads/qrcodes/${filename}.png`;
};

module.exports = { generateQRCode };
