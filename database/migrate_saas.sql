-- =============================================================================
-- VMS SaaS Migration — Step 11
-- Run this on vms_db ONCE to upgrade to the multi-department role model.
-- Safe to run on existing data.
-- =============================================================================

USE vms_db;

-- -----------------------------------------------------------------------------
-- 1. Temporarily remove the ENUM constraint to allow the rename
--    We change role_type to VARCHAR first, do the data migration,
--    then lock it back to the new ENUM.
-- -----------------------------------------------------------------------------

ALTER TABLE users
  MODIFY COLUMN role_type VARCHAR(20) NOT NULL DEFAULT 'employee';

-- -----------------------------------------------------------------------------
-- 2. Migrate existing 'admin' users → 'org_admin'
-- -----------------------------------------------------------------------------

UPDATE users SET role_type = 'org_admin' WHERE role_type = 'admin';

-- -----------------------------------------------------------------------------
-- 3. Lock back to the new ENUM with the full set of roles
-- -----------------------------------------------------------------------------

ALTER TABLE users
  MODIFY COLUMN role_type
  ENUM('org_admin', 'dept_admin', 'employee', 'security', 'receptionist')
  NOT NULL DEFAULT 'employee';

-- -----------------------------------------------------------------------------
-- 4. Make department_id nullable on users
--    org_admin does not belong to a specific department.
-- -----------------------------------------------------------------------------

ALTER TABLE users
  MODIFY COLUMN department_id INT NULL;

-- -----------------------------------------------------------------------------
-- 5. Add setup_complete flag to organizations
--    Allows the frontend to detect if initial setup is done.
--    Uses a stored procedure trick for compatibility with MySQL < 8.0
-- -----------------------------------------------------------------------------

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organizations' AND COLUMN_NAME = 'setup_complete');

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE organizations ADD COLUMN setup_complete BOOLEAN DEFAULT FALSE',
  'SELECT 1');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 6. Mark existing organizations as setup_complete (they were set up manually)
-- -----------------------------------------------------------------------------

UPDATE organizations SET setup_complete = TRUE;

-- -----------------------------------------------------------------------------
-- 7. Set org_admin users' department_id to NULL
--    They manage the entire org, not a single department.
-- -----------------------------------------------------------------------------

UPDATE users SET department_id = NULL WHERE role_type = 'org_admin';

-- -----------------------------------------------------------------------------
-- 8. Update index on users to reflect new scoping patterns
-- -----------------------------------------------------------------------------

-- idx_users_org_role already exists from schema — skip dropping (FK constraint).
-- Just add the dept-based index if not present.
SET @idx_exists = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'idx_users_dept_role');

SET @sql_idx = IF(@idx_exists = 0,
  'CREATE INDEX idx_users_dept_role ON users(department_id, role_type, is_active)',
  'SELECT 1');

PREPARE stmt_idx FROM @sql_idx;
EXECUTE stmt_idx;
DEALLOCATE PREPARE stmt_idx;

-- -----------------------------------------------------------------------------
-- Done. Verify with:
--   SHOW COLUMNS FROM users LIKE 'role_type';
--   SELECT id, full_name, role_type, department_id FROM users;
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 9. Create visitor_documents table (used for storing ID proofs for Aadhaar match)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS visitor_documents (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    visitor_id    INT          NOT NULL,
    id_type       VARCHAR(50)  NOT NULL,
    id_number     VARCHAR(100) NOT NULL,
    is_primary    BOOLEAN      DEFAULT FALSE,
    verified_by   INT          NULL,
    verified_at   TIMESTAMP    NULL,
    expiry_date   DATE         NULL,
    document_path VARCHAR(255) NULL,
    created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE,
    UNIQUE KEY unique_visitor_doc (visitor_id, id_type)
);

-- -----------------------------------------------------------------------------
-- 10. Add company_name, vendor_email columns to visit_requests (if not exists)
--     Required by the public request form for vendor/SPOT visits.
-- -----------------------------------------------------------------------------

SET @col1 = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'visit_requests' AND COLUMN_NAME = 'company_name');
SET @s1 = IF(@col1 = 0,
  'ALTER TABLE visit_requests ADD COLUMN company_name VARCHAR(100) NULL AFTER accompanying_count',
  'SELECT 1');
PREPARE stmt FROM @s1; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col2 = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'visit_requests' AND COLUMN_NAME = 'vendor_email');
SET @s2 = IF(@col2 = 0,
  'ALTER TABLE visit_requests ADD COLUMN vendor_email VARCHAR(100) NULL AFTER company_name',
  'SELECT 1');
PREPARE stmt FROM @s2; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 11. Add visit_category column (ENUM) to visit_requests if it doesn't exist
--     Some older schemas used visitor_type_id FK instead.
-- -----------------------------------------------------------------------------

SET @col3 = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'visit_requests' AND COLUMN_NAME = 'visit_category');
SET @s3 = IF(@col3 = 0,
  "ALTER TABLE visit_requests ADD COLUMN visit_category ENUM('EMP','VENDOR','PRIOR','SPOT') NOT NULL DEFAULT 'SPOT' AFTER status",
  'SELECT 1');
PREPARE stmt FROM @s3; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 12. Add role_type column to users if missing (for legacy schemas)
-- -----------------------------------------------------------------------------

SET @col4 = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role_type');
SET @s4 = IF(@col4 = 0,
  "ALTER TABLE users ADD COLUMN role_type ENUM('org_admin','dept_admin','employee','security','receptionist') NOT NULL DEFAULT 'employee'",
  'SELECT 1');
PREPARE stmt FROM @s4; EXECUTE stmt; DEALLOCATE PREPARE stmt;
