-- =============================================================================
-- VMS CENTRAL DATABASE SCHEMA
-- Database: vms_central
-- Contains: root org, unit registry, super-level users, global roles, global audit
-- Run: mysql -u root -p vms_central < database/vms_central_schema.sql
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- Root company record (1 row)
CREATE TABLE IF NOT EXISTS organizations (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    code       VARCHAR(50)  UNIQUE NOT NULL,
    type       VARCHAR(50),
    address    TEXT,
    city       VARCHAR(50),
    state      VARCHAR(50),
    phone      VARCHAR(20),
    email      VARCHAR(100),
    is_active  BOOLEAN      DEFAULT TRUE,
    created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Unit/Branch registry
CREATE TABLE IF NOT EXISTS units (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    organization_id INT          NOT NULL,
    name            VARCHAR(100) NOT NULL,
    code            VARCHAR(50)  UNIQUE NOT NULL,
    type            VARCHAR(50),
    db_name         VARCHAR(100) UNIQUE NOT NULL,
    db_status       ENUM('PROVISIONING','ACTIVE','SUSPENDED') DEFAULT 'PROVISIONING',
    address         TEXT,
    city            VARCHAR(50),
    state           VARCHAR(50),
    phone           VARCHAR(20),
    email           VARCHAR(100),
    is_active       BOOLEAN      DEFAULT TRUE,
    created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

-- Super admin + global auditor users ONLY (unit users live in their own unit DB)
CREATE TABLE IF NOT EXISTS users (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    role_type     ENUM('super_admin','global_auditor') NOT NULL,
    full_name     VARCHAR(100) NOT NULL,
    email         VARCHAR(100) UNIQUE NOT NULL,
    phone         VARCHAR(20)  UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    employee_code VARCHAR(50)  UNIQUE NOT NULL,
    is_active     BOOLEAN      DEFAULT TRUE,
    last_login_at TIMESTAMP    NULL,
    deleted_at    TIMESTAMP    NULL,
    created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Global role definitions (lookup only — not used for FK)
CREATE TABLE IF NOT EXISTS roles (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(50) NOT NULL,
    slug        VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    is_active   BOOLEAN     DEFAULT TRUE,
    created_at  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
);

-- Global visitor type codes (shared across all units)
CREATE TABLE IF NOT EXISTS visitor_types (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(50) NOT NULL,
    code       VARCHAR(20) NOT NULL UNIQUE,
    is_active  BOOLEAN     DEFAULT TRUE,
    created_at TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
);

-- Cross-unit audit trail (super admin actions + aggregated global events)
CREATE TABLE IF NOT EXISTS global_audit_logs (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT          NULL,
    source_unit VARCHAR(100) NULL,
    action      VARCHAR(100) NOT NULL,
    module      VARCHAR(50)  NOT NULL,
    record_type VARCHAR(50)  NOT NULL,
    record_id   INT,
    old_values  JSON,
    new_values  JSON,
    ip_address  VARCHAR(45),
    user_agent  TEXT,
    created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

SET FOREIGN_KEY_CHECKS = 1;

-- Roles
INSERT INTO roles (name, slug, description, is_active) VALUES
  ('Super Administrator', 'super_admin',     'Full system access across all units.',     TRUE),
  ('Unit Administrator',  'unit_admin',      'Full access within their unit.',            TRUE),
  ('Employee',            'employee',        'Standard employee with visit rights.',      TRUE),
  ('Security Guard',      'security',        'Gate check-in/out management.',             TRUE),
  ('Receptionist',        'receptionist',    'Visitor registration and front-desk.',      TRUE),
  ('Global Auditor',      'global_auditor',  'Read-only access to all unit reports.',     TRUE),
  ('Unit Auditor',        'unit_auditor',    'Read-only access to own unit reports.',     TRUE)
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- Visitor types
INSERT INTO visitor_types (name, code, is_active) VALUES
  ('Employee Visit',          'EMP',               TRUE),
  ('Supplier/Vendor/AMC',     'VENDOR',            TRUE),
  ('Prior Approved External', 'PRIOR',             TRUE),
  ('Spot Walk-in',            'SPOT',              TRUE),
  ('Personal Visit',          'PERSONAL_VISIT',    TRUE),
  ('Inter-Unit Visit',        'INTER_UNIT_VISIT',  TRUE),
  ('Inter-Unit Invite',       'INTER_UNIT_INVITE', TRUE)
ON DUPLICATE KEY UPDATE name=VALUES(name);


