-- =============================================================================
-- VMS Migration 002: Add Login Lockout Columns
-- Run on: vms_central + ALL vms_unit_* databases
--
-- Safe to run multiple times (IF NOT EXISTS guards).
-- Adds:
--   failed_attempts  TINYINT UNSIGNED  — consecutive bad login counter (resets on success)
--   locked_until     DATETIME          — NULL = not locked; future datetime = locked
-- =============================================================================

-- ── Central DB users table ────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until    DATETIME         NULL;
