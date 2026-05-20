-- =============================================================================
-- database/seed_data.sql
-- VMS — Initial Seed Data
--
-- This file is designed to be re-runnable safely using INSERT IGNORE and
-- ON DUPLICATE KEY UPDATE clauses.
--
-- IMPORTANT — Password Hash:
--   The password_hash below is the real bcrypt hash (cost factor 12) of the
--   plaintext password "Admin@1234", generated with:
--
--   node -e "const b=require('bcrypt'); b.hash('Admin@1234',12).then(console.log)"
--
--   Hash used: $2b$12$xQuINwOXcHaIMuARosSxH.eF4/Ba6QpLSW2vo5hnsZUHU/SxtwXnO
--
--   If you regenerate this seed (e.g. after a fresh clone), run that one-liner
--   to get a fresh hash and replace the value in the INSERT for users below.
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0; -- temporarily disable FK checks for safe re-seeding

-- =============================================================================
-- 1. ROLES
-- =============================================================================
INSERT INTO roles (name, slug, description, is_active)
VALUES
  ('Super Administrator', 'super_admin',   'Full system access across all organizations.',         TRUE),
  ('Administrator',       'admin',         'Organization-level administrative access.',            TRUE),
  ('Security Guard',      'security',      'Gate entry, exit management, and pass verification.',  TRUE),
  ('Receptionist',        'receptionist',  'Visitor registration and front-desk operations.',      TRUE),
  ('Host Employee',       'host',          'Receives and approves visits addressed to them.',      TRUE),
  ('Department Head',     'dept_head',     'Department-level oversight and visit approvals.',      TRUE)
ON DUPLICATE KEY UPDATE
  name        = VALUES(name),
  description = VALUES(description),
  is_active   = VALUES(is_active),
  updated_at  = CURRENT_TIMESTAMP;

-- =============================================================================
-- 2. VISITOR TYPES
--    Stored in visitor_types table. Assumes this table exists per the schema.
--    If visitor_types table is not present, remove this block.
-- =============================================================================
INSERT INTO visitor_types (name, code, is_active)
VALUES
  ('Employee Visit',           'EMP',    TRUE),
  ('Supplier/Vendor/AMC',      'VENDOR', TRUE),
  ('Prior Approved External',  'PRIOR',  TRUE),
  ('Spot Walk-in',             'SPOT',   TRUE)
ON DUPLICATE KEY UPDATE
  name      = VALUES(name),
  is_active = VALUES(is_active);

-- =============================================================================
-- 3. ORGANIZATION — SOBEIT HQ
-- =============================================================================
INSERT INTO organizations (name, code, type, city, state, is_active)
VALUES
  ('SOBEIT HQ', 'SBTQ', 'Corporate', 'Cuttack', 'Odisha', TRUE)
ON DUPLICATE KEY UPDATE
  name       = VALUES(name),
  type       = VALUES(type),
  city       = VALUES(city),
  state      = VALUES(state),
  is_active  = VALUES(is_active),
  updated_at = CURRENT_TIMESTAMP;

-- =============================================================================
-- 4. DEPARTMENT — IT Department (linked to SOBEIT HQ)
-- =============================================================================
INSERT INTO departments (organization_id, name, code, description, is_active)
VALUES
  (
    (SELECT id FROM organizations WHERE code = 'SBTQ'),
    'IT Department',
    'IT-DEPT',
    'Information Technology department responsible for all tech operations.',
    TRUE
  )
ON DUPLICATE KEY UPDATE
  name            = VALUES(name),
  description     = VALUES(description),
  organization_id = VALUES(organization_id),
  is_active       = VALUES(is_active),
  updated_at      = CURRENT_TIMESTAMP;

-- =============================================================================
-- 5. SUPER ADMIN USER
--
--   employee_code : EMP-001
--   full_name     : System Admin
--   email         : admin@sobeit.in
--   phone         : 9000000000
--   password      : Admin@1234  (see hash note at top of file)
-- =============================================================================
INSERT INTO users
  (organization_id, department_id, role_id, employee_code, full_name, email, phone, password_hash, designation, is_active)
VALUES
  (
    (SELECT id FROM organizations WHERE code = 'SBTQ'),
    (SELECT id FROM departments    WHERE code = 'IT-DEPT'),
    (SELECT id FROM roles          WHERE slug = 'super_admin'),
    'EMP-001',
    'System Admin',
    'admin@sobeit.in',
    '9000000000',
    -- Real bcrypt hash of "Admin@1234" at cost factor 12.
    -- Regenerate with: node -e "const b=require('bcrypt'); b.hash('Admin@1234',12).then(console.log)"
    '$2b$12$xQuINwOXcHaIMuARosSxH.eF4/Ba6QpLSW2vo5hnsZUHU/SxtwXnO',
    'System Administrator',
    TRUE
  )
ON DUPLICATE KEY UPDATE
  full_name   = VALUES(full_name),
  designation = VALUES(designation),
  role_id     = VALUES(role_id),
  is_active   = VALUES(is_active),
  updated_at  = CURRENT_TIMESTAMP;

SET FOREIGN_KEY_CHECKS = 1; -- re-enable FK checks

-- =============================================================================
-- END OF SEED
-- =============================================================================
