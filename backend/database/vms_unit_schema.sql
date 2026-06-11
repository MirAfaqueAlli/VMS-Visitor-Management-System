-- =============================================================================
-- VMS UNIT DATABASE SCHEMA TEMPLATE
-- Runs inside each unit's isolated database (e.g. vms_unit_hq)
-- NOTE: No cross-database foreign keys — unit_id references are logical only
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS departments (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    unit_id     INT          NOT NULL,
    name        VARCHAR(100) NOT NULL,
    code        VARCHAR(50)  UNIQUE NOT NULL,
    description TEXT,
    is_active   BOOLEAN      DEFAULT TRUE,
    created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS designations (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    department_id INT          NOT NULL,
    name          VARCHAR(100) NOT NULL,
    is_active     BOOLEAN      DEFAULT TRUE,
    created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    unit_id         INT          NOT NULL,
    department_id   INT          NULL,
    designation_id  INT          NULL,
    role_type       ENUM('unit_admin','employee','security','receptionist','unit_auditor') NOT NULL,
    employee_code   VARCHAR(50)  UNIQUE NOT NULL,
    full_name       VARCHAR(100) NOT NULL,
    email           VARCHAR(100) UNIQUE NOT NULL,
    phone           VARCHAR(20)  UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    designation     VARCHAR(100),
    is_active       BOOLEAN      DEFAULT TRUE,
    last_login_at   TIMESTAMP    NULL,
    deleted_at      TIMESTAMP    NULL,
    deleted_by      INT          NULL,
    created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id)  REFERENCES departments(id),
    FOREIGN KEY (designation_id) REFERENCES designations(id)
);

CREATE TABLE IF NOT EXISTS visitors (
    id                 INT AUTO_INCREMENT PRIMARY KEY,
    full_name          VARCHAR(100) NOT NULL,
    email              VARCHAR(100),
    phone              VARCHAR(20)  UNIQUE NOT NULL,
    address            TEXT,
    visitor_type       ENUM('individual','business') DEFAULT 'individual',
    is_mobile_verified BOOLEAN      DEFAULT FALSE,
    created_at         TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_visitor_phone ON visitors(phone);

CREATE TABLE IF NOT EXISTS visitor_documents (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    visitor_id    INT          NOT NULL,
    id_type       VARCHAR(50)  NOT NULL,
    id_number     VARCHAR(100) NOT NULL,
    is_primary    BOOLEAN      DEFAULT FALSE,
    created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE,
    UNIQUE KEY uq_visitor_doc (visitor_id, id_type)
);

CREATE TABLE IF NOT EXISTS blacklisted_visitors (
    id             INT       AUTO_INCREMENT PRIMARY KEY,
    visitor_id     INT       NOT NULL,
    reason         TEXT      NOT NULL,
    blacklisted_by INT       NOT NULL,
    is_active      BOOLEAN   DEFAULT TRUE,
    blacklisted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    lifted_at      TIMESTAMP NULL,
    lifted_by      INT       NULL,
    lift_reason    TEXT,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (visitor_id)     REFERENCES visitors(id),
    FOREIGN KEY (blacklisted_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS visit_requests (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    visitor_id        INT          NULL,
    visitor_phone     VARCHAR(20)  NULL,
    visitor_name      VARCHAR(100) NULL,
    visitor_email     VARCHAR(100) NULL,
    requester_user_id INT          NULL,
    host_user_id      INT          NOT NULL,
    department_id     INT          NOT NULL,
    unit_id           INT          NOT NULL,
    target_unit_id    INT          NULL,
    visit_category    ENUM('EMPLOYEE_VISIT','VENDOR','PRIOR','SPOT','PERSONAL_VISIT',
                           'INTER_UNIT_VISIT','INTER_UNIT_INVITE') NOT NULL,
    request_source    ENUM('SELF','RECEPTION','HOST','SYSTEM','PUBLIC') NOT NULL,
    company_name      VARCHAR(100) NULL,
    vendor_email      VARCHAR(100) NULL,
    purpose           TEXT         NOT NULL,
    visit_date        DATE         NOT NULL,
    visit_start_time  TIME         NULL,
    visit_end_time    TIME         NULL,
    accompanying_count INT         DEFAULT 0,
    status            ENUM('PENDING','APPROVED','REJECTED','CANCELLED','SCHEDULED','COMPLETED') DEFAULT 'PENDING',
    approved_by       INT          NULL,
    approved_at       TIMESTAMP    NULL,
    force_created     BOOLEAN      DEFAULT FALSE,
    created_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (visitor_id)        REFERENCES visitors(id),
    FOREIGN KEY (requester_user_id) REFERENCES users(id),
    FOREIGN KEY (host_user_id)      REFERENCES users(id),
    FOREIGN KEY (department_id)     REFERENCES departments(id),
    FOREIGN KEY (approved_by)       REFERENCES users(id)
);

CREATE INDEX idx_visit_request_date_status ON visit_requests(visit_date, status);

CREATE TABLE IF NOT EXISTS approval_history (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    visit_request_id INT  NOT NULL,
    acted_by_user_id INT  NOT NULL,
    action           ENUM('PENDING','APPROVED','REJECTED','CANCELLED') DEFAULT 'PENDING',
    remarks          TEXT,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (visit_request_id) REFERENCES visit_requests(id) ON DELETE CASCADE,
    FOREIGN KEY (acted_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS request_companions (
    id               INT          AUTO_INCREMENT PRIMARY KEY,
    visit_request_id INT          NOT NULL,
    full_name        VARCHAR(100) NOT NULL,
    id_type          VARCHAR(50),
    id_number        VARCHAR(100),
    created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (visit_request_id) REFERENCES visit_requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gate_passes (
    id               INT         AUTO_INCREMENT PRIMARY KEY,
    visit_request_id INT         NOT NULL UNIQUE,
    pass_number      VARCHAR(50) UNIQUE NOT NULL,
    qr_code_data     TEXT        NOT NULL,
    qr_code_path     VARCHAR(255),
    is_printed       BOOLEAN     DEFAULT FALSE,
    status           ENUM('ISSUED','USED','EXPIRED','CANCELLED') DEFAULT 'ISSUED',
    checkout_method  ENUM('DIRECT','QR_SCAN') NULL,
    qr_expires_at    DATETIME    NULL,
    issued_by        INT         NOT NULL,
    issued_at        TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at       TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (visit_request_id) REFERENCES visit_requests(id),
    FOREIGN KEY (issued_by)        REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS visit_logs (
    id                 INT          AUTO_INCREMENT PRIMARY KEY,
    gate_pass_id       INT          NOT NULL,
    visit_request_id   INT          NOT NULL,
    checked_in_by      INT          NOT NULL,
    checked_out_by     INT          NULL,
    visitor_photo_path VARCHAR(255),
    id_verified_type   VARCHAR(50),
    id_verified_number VARCHAR(100),
    check_in_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    check_out_at       TIMESTAMP    NULL,
    status             ENUM('ACTIVE','COMPLETED','GATE_REJECTED') DEFAULT 'ACTIVE',
    remarks            TEXT,
    created_at         TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (gate_pass_id)     REFERENCES gate_passes(id),
    FOREIGN KEY (visit_request_id) REFERENCES visit_requests(id),
    FOREIGN KEY (checked_in_by)    REFERENCES users(id),
    FOREIGN KEY (checked_out_by)   REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS gate_rejections (
    id               INT  AUTO_INCREMENT PRIMARY KEY,
    visit_request_id INT  NULL,
    visitor_id       INT  NULL,
    rejection_reason TEXT NOT NULL,
    rejected_by      INT  NOT NULL,
    rejected_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (visit_request_id) REFERENCES visit_requests(id),
    FOREIGN KEY (visitor_id)       REFERENCES visitors(id),
    FOREIGN KEY (rejected_by)      REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS employee_visitor_log (
    id               INT       AUTO_INCREMENT PRIMARY KEY,
    host_user_id     INT       NOT NULL,
    visitor_id       INT       NOT NULL,
    visit_request_id INT       NOT NULL,
    visit_log_id     INT       NOT NULL,
    department_id    INT       NOT NULL,
    checked_in_at    TIMESTAMP NOT NULL,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (host_user_id)     REFERENCES users(id),
    FOREIGN KEY (visitor_id)       REFERENCES visitors(id),
    FOREIGN KEY (visit_request_id) REFERENCES visit_requests(id),
    FOREIGN KEY (visit_log_id)     REFERENCES visit_logs(id),
    FOREIGN KEY (department_id)    REFERENCES departments(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id          INT          AUTO_INCREMENT PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS notifications (
    id                INT          AUTO_INCREMENT PRIMARY KEY,
    visit_request_id  INT          NULL,
    recipient_user_id INT          NULL,
    recipient_email   VARCHAR(100),
    recipient_phone   VARCHAR(20),
    notification_type ENUM('SMS','EMAIL','DASHBOARD') NOT NULL,
    subject           VARCHAR(200),
    message           TEXT         NOT NULL,
    status            ENUM('PENDING','SENT','FAILED') DEFAULT 'PENDING',
    failure_reason    TEXT,
    sent_at           TIMESTAMP    NULL,
    created_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (visit_request_id)  REFERENCES visit_requests(id) ON DELETE CASCADE,
    FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS otp_logs (
    id            INT         AUTO_INCREMENT PRIMARY KEY,
    user_id       INT         NULL,
    mobile_number VARCHAR(20) NOT NULL,
    otp_code      VARCHAR(10) NOT NULL,
    purpose       VARCHAR(50),
    is_used       BOOLEAN     DEFAULT FALSE,
    expires_at    TIMESTAMP   NOT NULL,
    created_at    TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_otp_lookup ON otp_logs(mobile_number, expires_at);

CREATE TABLE IF NOT EXISTS system_settings (
    id            INT          AUTO_INCREMENT PRIMARY KEY,
    setting_key   VARCHAR(100) NOT NULL UNIQUE,
    setting_value TEXT,
    description   TEXT,
    updated_by    INT          NULL,
    created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS host_phone_blacklist (
    id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    host_user_id   INT UNSIGNED NOT NULL,
    visitor_phone  VARCHAR(20)  NOT NULL,
    visitor_name   VARCHAR(120) NULL,
    reason         TEXT         NOT NULL,
    blocked_by     INT UNSIGNED NOT NULL,
    is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_host_phone (host_user_id, visitor_phone),
    INDEX idx_phone      (visitor_phone)
);

SET FOREIGN_KEY_CHECKS = 1;
