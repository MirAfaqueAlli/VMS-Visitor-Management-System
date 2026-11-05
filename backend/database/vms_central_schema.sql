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
    password_changed_at DATETIME NULL,
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

-- Public visitor OTP logs (central DB — no unit affiliation required)
CREATE TABLE IF NOT EXISTS public_otp_logs (
    id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    identifier       VARCHAR(255)              NOT NULL,
    identifier_type  ENUM('phone','email')     NOT NULL,
    otp_code         VARCHAR(64)               NOT NULL,
    is_used          BOOLEAN                   NOT NULL DEFAULT FALSE,
    attempts         INT                       NOT NULL DEFAULT 0,
    expires_at       DATETIME                  NOT NULL,
    created_at       DATETIME                  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pub_otp (identifier, identifier_type, is_used)
);

-- Visitor portal accounts (public visitors). One account per mobile number; the
-- visitor's requests and passes in every unit are found by that number (last 10
-- digits), so walk-ins added by staff can sign in with a mobile OTP and see them.
-- password_hash is NULL for accounts that only ever signed in by OTP.
CREATE TABLE IF NOT EXISTS visitor_accounts (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    phone               CHAR(10)      NOT NULL UNIQUE,
    email               VARCHAR(100)  NULL UNIQUE,
    full_name           VARCHAR(100)  NOT NULL,
    address             VARCHAR(255)  NULL,
    id_proof_type       VARCHAR(50)   NULL,   -- copied onto every visit request (checked at the gate)
    id_proof_number     VARCHAR(255)  NULL,   -- encrypted (crypto.util)
    photo_path          VARCHAR(255)  NULL,   -- the visitor's face photo (S3), optional
    password_hash       VARCHAR(255)  NULL,
    phone_verified_at   DATETIME      NULL,
    email_verified_at   DATETIME      NULL,
    failed_logins       INT           NOT NULL DEFAULT 0,
    locked_until        DATETIME      NULL,
    password_changed_at DATETIME      NULL,
    last_login_at       DATETIME      NULL,
    is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Accounts from the earlier portal version (origin/main 1aecbff). Kept only so
-- existing registrations can be copied into visitor_accounts at startup
-- (databaseInit.service.js); nothing writes to it any more.
CREATE TABLE IF NOT EXISTS public_registered_visitors (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    phone         VARCHAR(20)               NOT NULL UNIQUE,
    full_name     VARCHAR(150)              NOT NULL,
    email         VARCHAR(150)              NOT NULL,
    password_hash VARCHAR(255)              NULL,
    address       TEXT,
    company_name  VARCHAR(150)              NULL,
    created_at    DATETIME                  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME                  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_pub_reg_phone (phone),
    INDEX idx_pub_reg_email (email)
);

-- Pending staff login OTPs (step 2 of sign-in). Kept in the DB rather than in
-- process memory so they survive pm2 reloads and work across cluster workers.
-- Only SHA-256 hashes of the login token and the OTP are stored.
CREATE TABLE IF NOT EXISTS login_otp_sessions (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    token_hash  CHAR(64)     NOT NULL UNIQUE,
    user_id     INT          NOT NULL,
    unit_db     VARCHAR(100) NOT NULL,
    email       VARCHAR(100) NOT NULL,
    otp_hash    CHAR(64)     NOT NULL,
    attempts    INT          NOT NULL DEFAULT 0,
    is_used     BOOLEAN      NOT NULL DEFAULT FALSE,
    expires_at  DATETIME     NOT NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_login_otp_email  (email, created_at),
    INDEX idx_login_otp_user   (user_id, unit_db, is_used),
    INDEX idx_login_otp_expiry (expires_at)
);

-- Password reset links (forgot password). Only the SHA-256 hash of the link
-- token is stored; each link is single-use and short-lived.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    token_hash  CHAR(64)     NOT NULL UNIQUE,
    user_id     INT          NOT NULL,
    unit_db     VARCHAR(100) NOT NULL,
    email       VARCHAR(100) NOT NULL,
    is_used     BOOLEAN      NOT NULL DEFAULT FALSE,
    expires_at  DATETIME     NOT NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pwd_reset_email  (email, created_at),
    INDEX idx_pwd_reset_user   (user_id, unit_db, is_used),
    INDEX idx_pwd_reset_expiry (expires_at)
);

-- Failed sign-in counter per account identifier (unit scope + email/phone) for
-- account lockout. Keyed the same whether or not the account exists, so a lockout
-- never reveals which emails are registered.
CREATE TABLE IF NOT EXISTS login_failures (
    identifier      VARCHAR(255) NOT NULL PRIMARY KEY,
    failed_count    INT          NOT NULL DEFAULT 0,
    first_failed_at DATETIME     NOT NULL,
    locked_until    DATETIME     NULL
);

-- Once-a-day background jobs (e.g. reminders). The primary key lets exactly one
-- server process claim a given day's run, even with several pm2 workers.
CREATE TABLE IF NOT EXISTS scheduled_job_runs (
    job_name    VARCHAR(50)  NOT NULL,
    run_date    DATE         NOT NULL,
    started_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME     NULL,
    summary     VARCHAR(255) NULL,
    PRIMARY KEY (job_name, run_date)
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



-- Browser push subscriptions (system notifications while the app is closed or
-- minimised, desktop and mobile). One row per browser / device per signed-in user.
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id       INT           NOT NULL,
    unit_db       VARCHAR(64)   NOT NULL,          -- 'central' or the unit's DB name
    endpoint      VARCHAR(700)  NOT NULL,
    p256dh        VARCHAR(200)  NOT NULL,
    auth          VARCHAR(100)  NOT NULL,
    user_agent    VARCHAR(255)  NULL,
    created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at  DATETIME      NULL,
    UNIQUE KEY uq_push_endpoint (endpoint(255)),
    KEY idx_push_user (unit_db, user_id)
);

-- Small server settings (e.g. the generated Web Push VAPID key pair)
CREATE TABLE IF NOT EXISTS app_settings (
    setting_key   VARCHAR(100)  PRIMARY KEY,
    setting_value TEXT          NOT NULL,
    updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
