

CREATE DATABASE IF NOT EXISTS vms_db;
USE vms_db;

-- ------------------------------------------------------------------------------
-- 1. Lookups and Master Tables
-- ------------------------------------------------------------------------------

-- Removed visitor_types table

CREATE TABLE organizations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    type VARCHAR(50), -- "Government", "Industrial", "Corporate"
    address TEXT,
    city VARCHAR(50),
    state VARCHAR(50),
    phone VARCHAR(20),
    email VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE departments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    organization_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Removed roles table
-- ------------------------------------------------------------------------------
-- 2. Core Users
-- ------------------------------------------------------------------------------

CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    organization_id INT NOT NULL,
    department_id INT NOT NULL,
    role_type ENUM('admin', 'employee', 'security', 'receptionist') NOT NULL DEFAULT 'employee',
    pin_hash VARCHAR(255) NULL,
    agency_name VARCHAR(255) NULL,
    employee_code VARCHAR(50) UNIQUE NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE,
    phone VARCHAR(20) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    designation VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    last_login_at TIMESTAMP NULL,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    deleted_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ------------------------------------------------------------------------------
-- 3. Visitors
-- ------------------------------------------------------------------------------

CREATE TABLE visitors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    visitor_type ENUM('individual', 'business') NOT NULL DEFAULT 'individual',
    email VARCHAR(100),
    phone VARCHAR(20) UNIQUE NOT NULL,
    address TEXT,
    photo_path VARCHAR(255),
    is_mobile_verified BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP NULL,
    deleted_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (deleted_by) REFERENCES users(id)
);

CREATE INDEX idx_visitor_phone ON visitors(phone);

CREATE TABLE visitor_documents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    visitor_id INT NOT NULL,
    id_type ENUM('AADHAAR', 'PAN', 'DRIVING_LICENSE', 'PASSPORT', 'VOTER_ID', 'OTHER') NOT NULL,
    id_number VARCHAR(100) NOT NULL,
    document_path VARCHAR(255),
    is_primary BOOLEAN DEFAULT FALSE,
    verified_by INT NULL,
    verified_at TIMESTAMP NULL,
    expiry_date DATE NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE,
    FOREIGN KEY (verified_by) REFERENCES users(id),
    UNIQUE KEY unique_visitor_id_proof (visitor_id, id_type)
);

CREATE TABLE blacklisted_visitors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    visitor_id INT NOT NULL,
    reason TEXT NOT NULL,
    blacklisted_by INT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    blacklisted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    lifted_at TIMESTAMP NULL,
    lifted_by INT NULL,
    lift_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (visitor_id) REFERENCES visitors(id),
    FOREIGN KEY (blacklisted_by) REFERENCES users(id),
    FOREIGN KEY (lifted_by) REFERENCES users(id)
);

-- ------------------------------------------------------------------------------
-- 4. Visit Requests & Approvals
-- ------------------------------------------------------------------------------
CREATE TABLE individual_visitor_details (
    id INT AUTO_INCREMENT PRIMARY KEY,
    organization_id INT NOT NULL,
    visitor_id INT NOT NULL,
    address TEXT NULL,
    visit_category VARCHAR(100) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE
);

CREATE TABLE business_visitor_details (
    id INT AUTO_INCREMENT PRIMARY KEY,
    organization_id INT NOT NULL,
    visitor_id INT NOT NULL,
    company_name VARCHAR(255) NOT NULL,
    contact_person_name VARCHAR(255) NULL,
    gst_number VARCHAR(50) NULL,
    service_type VARCHAR(100) NULL,
    access_zone VARCHAR(100) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE
);
CREATE TABLE visit_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    visitor_id INT NULL, -- Null if internal employee
    requester_user_id INT NULL, -- Null if external visitor
    host_user_id INT NOT NULL,
    department_id INT NOT NULL,
    organization_id INT NOT NULL,
    visit_category ENUM('EMP', 'VENDOR', 'PRIOR', 'SPOT') NOT NULL,
    request_source ENUM('SELF', 'RECEPTION', 'HOST', 'SYSTEM') NOT NULL,
    purpose TEXT NOT NULL,
    visit_date DATE NOT NULL,
    visit_start_time TIME,
    visit_end_time TIME,
    accompanying_count INT DEFAULT 0,
    vehicle_details VARCHAR(255) NULL,
    work_order_ref VARCHAR(100) NULL,
    status ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED') DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (visitor_id) REFERENCES visitors(id),
    FOREIGN KEY (requester_user_id) REFERENCES users(id),
    FOREIGN KEY (host_user_id) REFERENCES users(id),
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CHECK (visitor_id IS NOT NULL OR requester_user_id IS NOT NULL)
);

CREATE INDEX idx_visit_request_date_status ON visit_requests(visit_date, status);

CREATE TABLE approval_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    organization_id INT NOT NULL,
    visit_request_id INT NOT NULL,
    acted_by_user_id INT NOT NULL,
    action ENUM('PENDING', 'APPROVED', 'REJECTED', 'ESCALATED', 'CANCELLED') NOT NULL,
    remarks TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (visit_request_id) REFERENCES visit_requests(id) ON DELETE CASCADE,
    FOREIGN KEY (acted_by_user_id) REFERENCES users(id)
);

CREATE TABLE request_companions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    visit_request_id INT NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    id_type ENUM('AADHAAR', 'PAN', 'DRIVING_LICENSE', 'PASSPORT', 'VOTER_ID', 'OTHER') NULL,
    id_number VARCHAR(100) NULL,
    photo_path VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (visit_request_id) REFERENCES visit_requests(id) ON DELETE CASCADE
);



-- ------------------------------------------------------------------------------
-- 5. Gate Management & Operations
-- ------------------------------------------------------------------------------

CREATE TABLE gate_passes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    visit_request_id INT NOT NULL UNIQUE,
    pass_number VARCHAR(50) UNIQUE NOT NULL,
    qr_code_data TEXT NOT NULL,
    qr_code_path VARCHAR(255),
    is_printed BOOLEAN DEFAULT FALSE,
    status ENUM('ISSUED', 'USED', 'EXPIRED', 'CANCELLED') DEFAULT 'ISSUED',
    issued_by INT NOT NULL,
    issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (visit_request_id) REFERENCES visit_requests(id),
    FOREIGN KEY (issued_by) REFERENCES users(id)
);

CREATE TABLE visit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    gate_pass_id INT NOT NULL,
    checked_in_by INT NOT NULL,
    checked_out_by INT NULL,
    visitor_photo_path VARCHAR(255),
    id_verified_type ENUM('AADHAAR', 'PAN', 'DRIVING_LICENSE', 'PASSPORT', 'VOTER_ID', 'OTHER') NULL,
    id_verified_number VARCHAR(100),
    check_in_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    check_out_at TIMESTAMP NULL,
    status ENUM('ACTIVE', 'COMPLETED', 'GATE_REJECTED') DEFAULT 'ACTIVE',
    remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (gate_pass_id) REFERENCES gate_passes(id),
    FOREIGN KEY (checked_in_by) REFERENCES users(id),
    FOREIGN KEY (checked_out_by) REFERENCES users(id)
);

CREATE TABLE qr_scan_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    organization_id INT NOT NULL,
    gate_pass_id INT NULL,
    scanned_by_user_id INT NOT NULL,
    qr_data TEXT NOT NULL,
    result ENUM('valid', 'invalid', 'expired', 'revoked', 'blacklisted') NOT NULL,
    failure_reason VARCHAR(255) NULL,
    device_id VARCHAR(100) NULL,
    ip_address VARCHAR(45) NULL,
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (gate_pass_id) REFERENCES gate_passes(id) ON DELETE SET NULL,
    FOREIGN KEY (scanned_by_user_id) REFERENCES users(id)
);

CREATE INDEX idx_qr_scan_logs_org_time ON qr_scan_logs(organization_id, scanned_at);

-- ------------------------------------------------------------------------------
-- 6. System & Logs
-- ------------------------------------------------------------------------------

CREATE TABLE otp_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    visitor_id INT NULL,
    user_id INT NULL,
    mobile_number VARCHAR(20) NOT NULL,
    otp_code VARCHAR(255) NOT NULL,
    purpose VARCHAR(50),
    is_used BOOLEAN DEFAULT FALSE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_otp_lookup ON otp_logs(mobile_number, expires_at);

CREATE TABLE notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    visit_request_id INT NULL,
    recipient_user_id INT NULL,
    recipient_visitor_id INT NULL,
    recipient_email VARCHAR(100),
    recipient_phone VARCHAR(20),
    notification_type ENUM('SMS', 'EMAIL', 'DASHBOARD') NOT NULL,
    channel VARCHAR(50),
    subject VARCHAR(200),
    message TEXT NOT NULL,
    status ENUM('PENDING', 'SENT', 'FAILED') DEFAULT 'PENDING',
    failure_reason TEXT,
    sent_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (visit_request_id) REFERENCES visit_requests(id) ON DELETE CASCADE,
    FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (recipient_visitor_id) REFERENCES visitors(id) ON DELETE CASCADE
);

CREATE INDEX idx_notifications_status ON notifications(status, created_at);

CREATE TABLE audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL, -- Nullable for system actions
    action VARCHAR(100) NOT NULL,
    module VARCHAR(50) NOT NULL,
    record_type VARCHAR(50) NOT NULL,
    record_id INT,
    old_values JSON,
    new_values JSON,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE system_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    organization_id INT NOT NULL,
    setting_key VARCHAR(100) NOT NULL,
    setting_value TEXT,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL,
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE KEY unique_org_setting (organization_id, setting_key)
);

CREATE TABLE financial_year_archives (
    id INT AUTO_INCREMENT PRIMARY KEY,
    organization_id INT NOT NULL,
    financial_year VARCHAR(20) NOT NULL, -- e.g., '2024-25'
    archive_status ENUM('PENDING', 'COMPLETED', 'HANDED_OVER') DEFAULT 'PENDING',
    backup_file_path VARCHAR(255),
    archived_by INT NULL,
    archived_at TIMESTAMP NULL,
    handed_over_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (archived_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE KEY unique_org_fy (organization_id, financial_year)
);
CREATE INDEX idx_users_org_role ON users(organization_id, role_type, is_active);
CREATE INDEX idx_dept_org_active ON departments(organization_id, is_active);
CREATE INDEX idx_vr_org_date_status ON visit_requests(organization_id, visit_date, status);
CREATE INDEX idx_ah_org_vr ON approval_history(organization_id, visit_request_id);
