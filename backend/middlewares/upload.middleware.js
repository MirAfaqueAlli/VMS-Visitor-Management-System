// backend/middlewares/upload.middleware.js
'use strict';

/**
 * Multer middleware using memoryStorage.
 *
 * Files are held in memory as Buffer objects (req.file.buffer).
 * The caller is responsible for uploading to S3 via utils/s3.util.js.
 * Nothing is written to local disk.
 */

const multer = require('multer');

// ── Shared memory storage ─────────────────────────────────────────────────────
// All upload handlers share one memoryStorage instance.
const memoryStorage = multer.memoryStorage();

// ── Visitor Photo upload ──────────────────────────────────────────────────────
const visitorPhotoFilter = (_req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.'));
  }
};

const uploadVisitorPhoto = multer({
  storage:    memoryStorage,
  fileFilter: visitorPhotoFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
}).single('photo');

// ── ID Proof upload ───────────────────────────────────────────────────────────
const idProofFilter = (_req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, and PDF files are allowed.'));
  }
};

const uploadIdProof = multer({
  storage:    memoryStorage,
  fileFilter: idProofFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
}).single('document');

module.exports = { uploadVisitorPhoto, uploadIdProof };
