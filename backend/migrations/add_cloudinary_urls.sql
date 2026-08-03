-- backend/migrations/add_cloudinary_urls.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Add Cloudinary URL columns to gate_passes and visit_logs
--
-- Run this against EACH unit database (e.g. vms_ho_db, vms_u2_db, ...)
-- Example:
--   mysql -u root -p vms_ho_db < migrations/add_cloudinary_urls.sql
--   mysql -u root -p vms_u2_db < migrations/add_cloudinary_urls.sql
--
-- Safe to run multiple times — uses IF NOT EXISTS / IGNORE patterns.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. gate_passes: add qr_code_url to store Cloudinary secure URL for QR images
ALTER TABLE gate_passes
  ADD COLUMN IF NOT EXISTS qr_code_url VARCHAR(512) NULL DEFAULT NULL
    COMMENT 'Cloudinary secure URL for the QR code image (null = local-only)';

-- 2. visit_logs: add visitor_photo_url to store Cloudinary secure URL for visitor photos
ALTER TABLE visit_logs
  ADD COLUMN IF NOT EXISTS visitor_photo_url VARCHAR(512) NULL DEFAULT NULL
    COMMENT 'Cloudinary secure URL for the visitor photo taken at check-in (null = local-only)';

-- Done
SELECT 'Migration add_cloudinary_urls applied successfully.' AS status;
