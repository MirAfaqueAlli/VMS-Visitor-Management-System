-- Target: all
-- =============================================================================
-- VMS Migration 002: Add Login Lockout Columns
-- Applied automatically on server startup via databaseInit.service.js
-- Tracked in: schema_migrations
-- =============================================================================

ALTER TABLE users ADD COLUMN failed_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until DATETIME NULL;

