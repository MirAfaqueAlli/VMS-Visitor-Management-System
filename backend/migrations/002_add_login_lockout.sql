-- =============================================================================
-- VMS Migration 002: Add Login Lockout Columns
-- Applied automatically on server startup via databaseInit.service.js
-- Tracked in: vms_central.schema_migrations
--
-- This file runs inside vms_central context.
-- The same columns are also applied to every vms_unit_* DB via the
-- addColumnIfMissing() calls in migrateUnitDatabase() which run as Step 3.
--
-- Safe to re-run: IF NOT EXISTS guards prevent duplicate-column errors.
-- =============================================================================

-- ── Central DB: users table ───────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until    DATETIME         NULL;
