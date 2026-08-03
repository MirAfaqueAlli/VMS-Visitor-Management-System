// backend/services/cloudinary.service.js
'use strict';

/**
 * Cloudinary Upload Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides a single `uploadToCloudinary(filePath, options)` helper that:
 *  1. Compresses the image using Sharp (JPEG/WebP/PNG) before uploading.
 *  2. Uploads the compressed buffer to Cloudinary.
 *  3. Returns the secure Cloudinary URL.
 *  4. Gracefully no-ops (returns null) when CLOUDINARY_ENABLED !== 'true'
 *     or when credentials are missing — so local-only mode still works.
 *
 * SETUP:
 *   In your .env set:
 *     CLOUDINARY_CLOUD_NAME=<your-cloud-name>
 *     CLOUDINARY_API_KEY=<your-api-key>
 *     CLOUDINARY_API_SECRET=<your-api-secret>
 *     CLOUDINARY_ENABLED=true
 */

const cloudinary = require('cloudinary').v2;
const sharp      = require('sharp');
const fs         = require('fs');
const path       = require('path');
const { Readable } = require('stream');

// ── Feature flag ──────────────────────────────────────────────────────────────
const ENABLED =
  process.env.CLOUDINARY_ENABLED?.trim().toLowerCase() === 'true' &&
  process.env.CLOUDINARY_CLOUD_NAME?.trim() &&
  process.env.CLOUDINARY_API_KEY?.trim() &&
  process.env.CLOUDINARY_API_SECRET?.trim();

if (ENABLED) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME.trim(),
    api_key:    process.env.CLOUDINARY_API_KEY.trim(),
    api_secret: process.env.CLOUDINARY_API_SECRET.trim(),
    secure:     true,
  });
  console.info('[Cloudinary] ✓ Cloudinary integration enabled.');
} else {
  console.info('[Cloudinary] ℹ Cloudinary integration disabled (CLOUDINARY_ENABLED=false or credentials missing). Images will only be stored locally.');
}

// ── Compression presets ───────────────────────────────────────────────────────
const PRESETS = {
  /**
   * Visitor photo — compress to JPEG, max 800×800, quality 82
   * Typical size reduction: ~70–85% from raw captures
   */
  visitor_photo: {
    format:  'jpeg',
    quality: 82,
    width:   800,
    height:  800,
    fit:     'inside',  // never upscale, preserves aspect ratio
    folder:  'vms/visitor-photos',
  },
  /**
   * QR Code — keep as PNG (lossless) at 300×300, compress with optipng
   * Sharp's PNG compression level 9 is safe for QR readability.
   */
  qr_code: {
    format:       'png',
    pngLevel:     8,    // 0-9, higher = smaller file
    width:        300,
    height:       300,
    fit:          'inside',
    folder:       'vms/qrcodes',
  },
};

/**
 * Compress an image buffer/file with Sharp.
 *
 * @param {Buffer|string} input  - Buffer or absolute file path.
 * @param {'visitor_photo'|'qr_code'} preset - Which compression preset to use.
 * @returns {Promise<Buffer>} Compressed image buffer.
 */
const compress = async (input, preset = 'visitor_photo') => {
  const cfg = PRESETS[preset] ?? PRESETS.visitor_photo;

  let pipeline = sharp(input).resize({
    width:    cfg.width,
    height:   cfg.height,
    fit:      cfg.fit,
    withoutEnlargement: true,
  });

  if (cfg.format === 'jpeg') {
    pipeline = pipeline.jpeg({ quality: cfg.quality, mozjpeg: true });
  } else if (cfg.format === 'webp') {
    pipeline = pipeline.webp({ quality: cfg.quality });
  } else {
    // PNG
    pipeline = pipeline.png({ compressionLevel: cfg.pngLevel ?? 8 });
  }

  return pipeline.toBuffer();
};

/**
 * Upload a local image file to Cloudinary (with compression).
 *
 * @param {string} localFilePath   - Absolute path to the locally saved file.
 * @param {'visitor_photo'|'qr_code'} preset - Compression / folder preset.
 * @param {string} [publicId]      - Optional custom public_id in Cloudinary.
 *                                   Auto-generated if omitted.
 * @returns {Promise<string|null>}  - Cloudinary secure_url, or null if disabled.
 */
const uploadToCloudinary = async (localFilePath, preset = 'visitor_photo', publicId = null) => {
  if (!ENABLED) return null;

  try {
    const cfg = PRESETS[preset] ?? PRESETS.visitor_photo;

    // 1. Read file and compress
    const rawBuffer      = fs.readFileSync(localFilePath);
    const compressedBuf  = await compress(rawBuffer, preset);

    // 2. Stream upload to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder:           cfg.folder,
          public_id:        publicId ?? undefined,
          resource_type:    'image',
          overwrite:        true,
          unique_filename:  !publicId,
          format:           cfg.format,
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );

      // Convert buffer to readable stream and pipe into Cloudinary
      const readable = new Readable();
      readable.push(compressedBuf);
      readable.push(null);
      readable.pipe(stream);
    });

    console.info(`[Cloudinary] Uploaded "${preset}": ${uploadResult.secure_url}`);
    return uploadResult.secure_url;

  } catch (err) {
    // Never crash the main flow — Cloudinary upload is supplementary to local storage
    console.error(`[Cloudinary] Upload failed for "${localFilePath}": ${err.message}`);
    return null;
  }
};

/**
 * Upload an in-memory Buffer to Cloudinary (used for QR codes generated in-memory).
 *
 * @param {Buffer} buffer         - Image data buffer.
 * @param {'visitor_photo'|'qr_code'} preset
 * @param {string} [publicId]     - Custom public_id.
 * @returns {Promise<string|null>}
 */
const uploadBufferToCloudinary = async (buffer, preset = 'qr_code', publicId = null) => {
  if (!ENABLED) return null;

  try {
    const cfg = PRESETS[preset] ?? PRESETS.qr_code;

    // Compress
    const compressedBuf = await compress(buffer, preset);

    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder:          cfg.folder,
          public_id:       publicId ?? undefined,
          resource_type:   'image',
          overwrite:       true,
          unique_filename: !publicId,
          format:          cfg.format,
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );

      const readable = new Readable();
      readable.push(compressedBuf);
      readable.push(null);
      readable.pipe(stream);
    });

    console.info(`[Cloudinary] Buffer uploaded "${preset}": ${uploadResult.secure_url}`);
    return uploadResult.secure_url;

  } catch (err) {
    console.error(`[Cloudinary] Buffer upload failed: ${err.message}`);
    return null;
  }
};

module.exports = {
  uploadToCloudinary,
  uploadBufferToCloudinary,
  isEnabled: () => ENABLED,
};
