// backend/middlewares/upload.middleware.js
'use strict';

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

// ── Ensure upload directories exist on startup ───────────────────────────────
const PHOTO_DIR    = path.join(__dirname, '..', 'uploads', 'visitor-photos');
const ID_PROOF_DIR = path.join(__dirname, '..', 'uploads', 'id-proofs');
const QR_DIR       = path.join(__dirname, '..', 'uploads', 'qrcodes');

[PHOTO_DIR, ID_PROOF_DIR, QR_DIR].forEach((dir) => {
  fs.mkdirSync(dir, { recursive: true });
});

// ── Visitor Photo storage ─────────────────────────────────────────────────────
const visitorPhotoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PHOTO_DIR),
  filename:    (_req, file,  cb) =>
    cb(null, `photo-${Date.now()}-${file.originalname}`),
});

const visitorPhotoFilter = (_req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.'));
  }
};

const uploadVisitorPhoto = multer({
  storage:  visitorPhotoStorage,
  fileFilter: visitorPhotoFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
}).single('photo');

// ── ID Proof storage ──────────────────────────────────────────────────────────
const idProofStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, ID_PROOF_DIR),
  filename:    (_req, file,  cb) =>
    cb(null, `id-${Date.now()}-${file.originalname}`),
});

const idProofFilter = (_req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, and PDF files are allowed.'));
  }
};

const uploadIdProof = multer({
  storage:  idProofStorage,
  fileFilter: idProofFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
}).single('document');

module.exports = { uploadVisitorPhoto, uploadIdProof };
