-- =============================================================================
-- VMS FULL SETUP — Schema + Seed (Correct version matching the backend)
-- Run: Get-Content .\database\vms_full_setup.sql | mysql -u root -p vms_db
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ── 1. LOOKUP & MASTER TABLES ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS visitor_types (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(50)  NOT NULL,
    code       VARCHAR(20)  NOT NULL UNIQUE,
    is_active  BOOLEAN      DEFAULT TRUE,
    created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

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

CREATE TABLE IF NOT EXISTS departments (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    organization_id INT          NOT NULL,
    name            VARCHAR(100) NOT NULL,
    code            VARCHAR(50)  UNIQUE NOT NULL,
    description     TEXT,
    is_active       BOOLEAN      DEFAULT TRUE,
    created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS roles (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(50) NOT NULL,
    slug        VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    is_active   BOOLEAN     DEFAULT TRUE,
    created_at  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ── 2. USERS ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    organization_id INT          NOT NULL,
    department_id   INT          NOT NULL,
    role_id         INT          NOT NULL,
    employee_code   VARCHAR(50)  UNIQUE NOT NULL,
    full_name       VARCHAR(100) NOT NULL,
    email           VARCHAR(100) UNIQUE,
    phone           VARCHAR(20)  UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    designation     VARCHAR(100),
    is_active       BOOLEAN      DEFAULT TRUE,
    last_login_at   TIMESTAMP    NULL,
    created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (department_id)   REFERENCES departments(id),
    FOREIGN KEY (role_id)         REFERENCES roles(id)
);

-- ── 3. VISITORS ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS visitors (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    full_name           VARCHAR(100) NOT NULL,
    email               VARCHAR(100),
    phone               VARCHAR(20)  UNIQUE NOT NULL,
    address             TEXT,
    photo_path          VARCHAR(255),
    is_mobile_verified  BOOLEAN      DEFAULT FALSE,
    created_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_visitor_phone ON visitors(phone);

CREATE TABLE IF NOT EXISTS visitor_id_proofs (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    visitor_id    INT         NOT NULL,
    id_type       VARCHAR(50) NOT NULL,
    id_number     VARCHAR(100) NOT NULL,
    document_path VARCHAR(255),
    is_primary    BOOLEAN     DEFAULT FALSE,
    created_at    TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE,
    UNIQUE KEY unique_visitor_id_proof (visitor_id, id_type)
);

CREATE TABLE IF NOT EXISTS blacklisted_visitors (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    visitor_id       INT       NOT NULL,
    reason           TEXT      NOT NULL,
    blacklisted_by   INT       NOT NULL,
    is_active        BOOLEAN   DEFAULT TRUE,
    blacklisted_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    lifted_at        TIMESTAMP NULL,
    lifted_by        INT       NULL,
    lift_reason      TEXT,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (visitor_id)     REFERENCES visitors(id),
    FOREIGN KEY (blacklisted_by) REFERENCES users(id),
    FOREIGN KEY (lifted_by)      REFERENCES users(id)
);

-- ── 4. VISIT REQUESTS & APPROVALS ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS visit_requests (
    id                 INT AUTO_INCREMENT PRIMARY KEY,
    visitor_id         INT  NULL,
    requester_user_id  INT  NULL,
    host_user_id       INT  NOT NULL,
    department_id      INT  NOT NULL,
    organization_id    INT  NOT NULL,
    visitor_type_id    INT  NOT NULL,
    request_source     ENUM('SELF','RECEPTION','HOST','SYSTEM') NOT NULL,
    purpose            TEXT NOT NULL,
    visit_date         DATE NOT NULL,
    visit_start_time   TIME,
    visit_end_time     TIME,
    accompanying_count INT  DEFAULT 0,
    status             ENUM('PENDING','APPROVED','REJECTED','CANCELLED','SCHEDULED','COMPLETED') DEFAULT 'PENDING',
    approved_by        INT  NULL,
    approved_at        TIMESTAMP NULL,
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (visitor_id)        REFERENCES visitors(id),
    FOREIGN KEY (requester_user_id) REFERENCES users(id),
    FOREIGN KEY (host_user_id)      REFERENCES users(id),
    FOREIGN KEY (department_id)     REFERENCES departments(id),
    FOREIGN KEY (organization_id)   REFERENCES organizations(id),
    FOREIGN KEY (visitor_type_id)   REFERENCES visitor_types(id),
    FOREIGN KEY (approved_by)       REFERENCES users(id),
    CHECK (visitor_id IS NOT NULL OR requester_user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_visit_request_date_status ON visit_requests(visit_date, status);

CREATE TABLE IF NOT EXISTS approval_workflows (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    visit_request_id INT NOT NULL,
    approver_user_id INT NOT NULL,
    approval_level   INT DEFAULT 1,
    action           ENUM('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING',
    remarks          TEXT,
    actioned_at      TIMESTAMP NULL,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (visit_request_id) REFERENCES visit_requests(id) ON DELETE CASCADE,
    FOREIGN KEY (approver_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS request_companions (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    visit_request_id INT          NOT NULL,
    full_name        VARCHAR(100) NOT NULL,
    id_type          VARCHAR(50),
    id_number        VARCHAR(100),
    photo_path       VARCHAR(255),
    created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (visit_request_id) REFERENCES visit_requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS supplier_vendor_details (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    visit_request_id INT          NOT NULL UNIQUE,
    company_name     VARCHAR(100) NOT NULL,
    contact_person   VARCHAR(100),
    gst_number       VARCHAR(50),
    work_order_ref   VARCHAR(100),
    service_type     VARCHAR(100),
    created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (visit_request_id) REFERENCES visit_requests(id) ON DELETE CASCADE
);

-- ── 5. GATE MANAGEMENT ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gate_passes (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    visit_request_id INT          NOT NULL UNIQUE,
    pass_number      VARCHAR(50)  UNIQUE NOT NULL,
    qr_code_data     TEXT         NOT NULL,
    qr_code_path     VARCHAR(255),
    is_printed       BOOLEAN      DEFAULT FALSE,
    status           ENUM('ISSUED','USED','EXPIRED','CANCELLED') DEFAULT 'ISSUED',
    issued_by        INT          NOT NULL,
    issued_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (visit_request_id) REFERENCES visit_requests(id),
    FOREIGN KEY (issued_by)        REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS visit_logs (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    gate_pass_id        INT          NOT NULL,
    visit_request_id    INT          NOT NULL,
    checked_in_by       INT          NOT NULL,
    checked_out_by      INT          NULL,
    visitor_photo_path  VARCHAR(255),
    id_verified_type    VARCHAR(50),
    id_verified_number  VARCHAR(100),
    check_in_at         TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    check_out_at        TIMESTAMP    NULL,
    status              ENUM('ACTIVE','COMPLETED','GATE_REJECTED') DEFAULT 'ACTIVE',
    remarks             TEXT,
    created_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (gate_pass_id)     REFERENCES gate_passes(id),
    FOREIGN KEY (visit_request_id) REFERENCES visit_requests(id),
    FOREIGN KEY (checked_in_by)    REFERENCES users(id),
    FOREIGN KEY (checked_out_by)   REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS gate_rejections (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    visit_request_id INT  NULL,
    visitor_id       INT  NULL,
    rejection_reason TEXT NOT NULL,
    rejected_by      INT  NOT NULL,
    rejected_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (visit_request_id) REFERENCES visit_requests(id),
    FOREIGN KEY (visitor_id)       REFERENCES visitors(id),
    FOREIGN KEY (rejected_by)      REFERENCES users(id)
);

-- ── 6. SYSTEM & LOGS ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS otp_logs (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    visitor_id    INT         NULL,
    user_id       INT         NULL,
    mobile_number VARCHAR(20) NOT NULL,
    otp_code      VARCHAR(10) NOT NULL,
    purpose       VARCHAR(50),
    is_used       BOOLEAN     DEFAULT FALSE,
    expires_at    TIMESTAMP   NOT NULL,
    created_at    TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_otp_lookup ON otp_logs(mobile_number, expires_at);

CREATE TABLE IF NOT EXISTS notifications (
    id                   INT AUTO_INCREMENT PRIMARY KEY,
    visit_request_id     INT          NULL,
    recipient_user_id    INT          NULL,
    recipient_visitor_id INT          NULL,
    recipient_email      VARCHAR(100),
    recipient_phone      VARCHAR(20),
    notification_type    ENUM('SMS','EMAIL','DASHBOARD') NOT NULL,
    channel              VARCHAR(50),
    subject              VARCHAR(200),
    message              TEXT         NOT NULL,
    status               ENUM('PENDING','SENT','FAILED') DEFAULT 'PENDING',
    failure_reason       TEXT,
    sent_at              TIMESTAMP    NULL,
    created_at           TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (visit_request_id)     REFERENCES visit_requests(id) ON DELETE CASCADE,
    FOREIGN KEY (recipient_user_id)    REFERENCES users(id)          ON DELETE CASCADE,
    FOREIGN KEY (recipient_visitor_id) REFERENCES visitors(id)       ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT          NULL,
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

CREATE TABLE IF NOT EXISTS system_settings (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    organization_id INT          NOT NULL,
    setting_key     VARCHAR(100) NOT NULL,
    setting_value   TEXT,
    description     TEXT,
    created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by      INT          NULL,
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by)      REFERENCES users(id)         ON DELETE SET NULL,
    UNIQUE KEY unique_org_setting (organization_id, setting_key)
);

CREATE TABLE IF NOT EXISTS financial_year_archives (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    organization_id INT         NOT NULL,
    financial_year  VARCHAR(20) NOT NULL,
    archive_status  ENUM('PENDING','COMPLETED','HANDED_OVER') DEFAULT 'PENDING',
    backup_file_path VARCHAR(255),
    archived_by     INT         NULL,
    archived_at     TIMESTAMP   NULL,
    handed_over_at  TIMESTAMP   NULL,
    created_at      TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (archived_by)     REFERENCES users(id)         ON DELETE SET NULL,
    UNIQUE KEY unique_org_fy (organization_id, financial_year)
);

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- SEED DATA
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- Roles
INSERT INTO roles (name, slug, description, is_active) VALUES
  ('Super Administrator', 'super_admin',  'Full system access.',                          TRUE),
  ('Administrator',       'admin',        'Organization-level administrative access.',    TRUE),
  ('Security Guard',      'security',     'Gate entry, exit management.',                 TRUE),
  ('Receptionist',        'receptionist', 'Visitor registration and front-desk.',         TRUE),
  ('Host Employee',       'host',         'Receives and approves visits.',                TRUE),
  ('Department Head',     'dept_head',    'Department-level oversight and approvals.',    TRUE)
ON DUPLICATE KEY UPDATE name=VALUES(name), updated_at=CURRENT_TIMESTAMP;

-- Visitor Types
INSERT INTO visitor_types (name, code, is_active) VALUES
  ('Employee Visit',          'EMP',    TRUE),
  ('Supplier/Vendor/AMC',     'VENDOR', TRUE),
  ('Prior Approved External', 'PRIOR',  TRUE),
  ('Spot Walk-in',            'SPOT',   TRUE)
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- Organization
INSERT INTO organizations (name, code, type, city, state, is_active) VALUES
  ('SOBEIT HQ', 'SBTQ', 'Corporate', 'Cuttack', 'Odisha', TRUE)
ON DUPLICATE KEY UPDATE name=VALUES(name), updated_at=CURRENT_TIMESTAMP;

-- Department
INSERT INTO departments (organization_id, name, code, description, is_active) VALUES
  ((SELECT id FROM organizations WHERE code='SBTQ'), 'IT Department', 'IT-DEPT', 'Information Technology department.', TRUE)
ON DUPLICATE KEY UPDATE name=VALUES(name), updated_at=CURRENT_TIMESTAMP;

-- Super Admin User (password: Admin@1234)
INSERT INTO users (organization_id, department_id, role_id, employee_code, full_name, email, phone, password_hash, designation, is_active) VALUES
  (
    (SELECT id FROM organizations WHERE code='SBTQ'),
    (SELECT id FROM departments    WHERE code='IT-DEPT'),
    (SELECT id FROM roles          WHERE slug='super_admin'),
    'EMP-001', 'System Admin', 'admin@sobeit.in', '9000000000',
    '$2b$12$xQuINwOXcHaIMuARosSxH.eF4/Ba6QpLSW2vo5hnsZUHU/SxtwXnO',
    'System Administrator', TRUE
  )
ON DUPLICATE KEY UPDATE full_name=VALUES(full_name), updated_at=CURRENT_TIMESTAMP;

-- Security User (password: Security@1234)
INSERT INTO users (organization_id, department_id, role_id, employee_code, full_name, email, phone, password_hash, designation, is_active) VALUES
  (
    (SELECT id FROM organizations WHERE code='SBTQ'),
    (SELECT id FROM departments    WHERE code='IT-DEPT'),
    (SELECT id FROM roles          WHERE slug='security'),
    'EMP-SEC-01', 'Gate Security', 'security@sobeit.in', '9000000001',
    '$2b$12$1w79P1EHpNHnvCnWg3.b7uUGTDY4fK/CE4OdeeEDcswndUpIGedBS',
    'Security Officer', TRUE
  )
ON DUPLICATE KEY UPDATE full_name=VALUES(full_name), updated_at=CURRENT_TIMESTAMP;

-- Host User (password: Host@1234)
INSERT INTO users (organization_id, department_id, role_id, employee_code, full_name, email, phone, password_hash, designation, is_active) VALUES
  (
    (SELECT id FROM organizations WHERE code='SBTQ'),
    (SELECT id FROM departments    WHERE code='IT-DEPT'),
    (SELECT id FROM roles          WHERE slug='host'),
    'EMP-HOST-01', 'Rahul Sharma', 'host@sobeit.in', '9000000002',
    '$2b$12$xQuINwOXcHaIMuARosSxH.eF4/Ba6QpLSW2vo5hnsZUHU/SxtwXnO',
    'Senior Engineer', TRUE
  )
ON DUPLICATE KEY UPDATE full_name=VALUES(full_name), updated_at=CURRENT_TIMESTAMP;

SET FOREIGN_KEY_CHECKS = 1;
