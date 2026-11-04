// backend/utils/photo.util.js
'use strict';

/**
 * Visitor photos are stored square (800 × 800 JPEG), whatever was uploaded:
 * the image is turned upright (phone EXIF rotation) and cropped to a centred
 * square — never stretched — so it fits the gate pass and check-in screens.
 */

const sharp = require('sharp');

const SIDE = 800;

/** @returns {Promise<{ buffer: Buffer, mimeType: 'image/jpeg', ext: 'jpg' }>} */
async function squarePhoto(input) {
  const buffer = await sharp(input)
    .rotate()                                            // respect EXIF orientation
    .resize(SIDE, SIDE, { fit: 'cover', position: 'attention' })   // crop to the most detailed area (the face)
    .flatten({ background: '#ffffff' })                  // transparent PNGs → white
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  return { buffer, mimeType: 'image/jpeg', ext: 'jpg' };
}

module.exports = { squarePhoto };
