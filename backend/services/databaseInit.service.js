// backend/services/databaseInit.service.js
'use strict';

const fs    = require('fs');
const path  = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const BASE_CONFIG = {
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '3306', 10),
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || process.env.DB_PASS || '',
  waitForConnections: true,
  connectionLimit:    5,
};

const CENTRAL_DB = process.env.DB_CENTRAL_NAME || 'vms_central';

/**
 * Execute SQL file line-by-line to avoid issues with CRLF line endings
 * or multi-statement semicolons.
 */
async function executeSqlFile(conn, filePath, targetDb = null) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`SQL file not found at: ${filePath}`);
  }

  if (targetDb) {
    await conn.query(`USE \`${targetDb}\``);
  }

  const rawSql = fs.readFileSync(filePath, 'utf8');
  const lines  = rawSql.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  const statements = [];
  let buffer = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('--')) continue;

    buffer += (buffer ? '\n' : '') + line;

    if (line.endsWith(';')) {
      const stmt = buffer.trim();
      if (stmt && stmt !== ';') {
        statements.push(stmt);
      }
      buffer = '';
    }
  }

  if (buffer.trim()) {
    statements.push(buffer.trim());
  }

  for (const stmt of statements) {
    try {
      await conn.query(stmt);
    } catch (err) {
      // Ignore "already exists" or duplicate key errors during idempotent bootstrap
      if (err.errno === 1060 || err.errno === 1061 || err.errno === 1050) continue;
      console.warn(`[DatabaseInit] Warning executing statement: ${err.message}`);
    }
  }
}

/**
 * Safely adds a column if it does not already exist.
 */
async function addColumnIfMissing(conn, dbName, tableName, columnName, columnDef) {
  const [cols] = await conn.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [dbName, tableName, columnName]
  );
  if (cols.length > 0) return false;

  await conn.query(`ALTER TABLE \`${dbName}\`.\`${tableName}\` ADD COLUMN ${columnName} ${columnDef}`);
  return true;
}

/**
 * Safely adds an index if it does not already exist.
 */
async function addIndexIfMissing(conn, dbName, tableName, indexName, columnsSql) {
  const [idx] = await conn.query(
    `SELECT INDEX_NAME
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [dbName, tableName, indexName]
  );
  if (idx.length > 0) return false;

  await conn.query(`CREATE INDEX \`${indexName}\` ON \`${dbName}\`.\`${tableName}\` ${columnsSql}`);
  return true;
}

/**
 * Drops a foreign key constraint if it exists.
 */
async function dropFkIfExists(conn, dbName, tableName, columnName) {
  const [colFks] = await conn.query(
    `SELECT kcu.CONSTRAINT_NAME
     FROM information_schema.KEY_COLUMN_USAGE kcu
     JOIN information_schema.TABLE_CONSTRAINTS tc
       ON  tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
       AND tc.TABLE_SCHEMA    = kcu.TABLE_SCHEMA
       AND tc.TABLE_NAME      = kcu.TABLE_NAME
     WHERE kcu.TABLE_SCHEMA    = ?
       AND kcu.TABLE_NAME      = ?
       AND kcu.COLUMN_NAME     = ?
       AND tc.CONSTRAINT_TYPE  = 'FOREIGN KEY'`,
    [dbName, tableName, columnName]
  );

  for (const fk of colFks) {
    try {
      await conn.query(`ALTER TABLE \`${dbName}\`.\`${tableName}\` DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``);
    } catch (_) {}
  }
}

/**
 * Ensures Central Database exists, has tables, and lookup seeds.
 */
async function ensureCentralDatabase(adminConn) {
  await adminConn.query(
    `CREATE DATABASE IF NOT EXISTS \`${CENTRAL_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );

  const centralSchemaPath = path.join(__dirname, '../database/vms_central_schema.sql');
  await executeSqlFile(adminConn, centralSchemaPath, CENTRAL_DB);

  // Wrong-guess counter for public OTPs (brute-force limit)
  await addColumnIfMissing(adminConn, CENTRAL_DB, 'public_otp_logs', 'attempts', 'INT NOT NULL DEFAULT 0 AFTER is_used');
  // Sessions issued before the last password change/reset are rejected (auth.middleware)
  await addColumnIfMissing(adminConn, CENTRAL_DB, 'users', 'password_changed_at', 'DATETIME NULL AFTER password_hash');

  // Guarantee seed data is present in central lookup tables
  await adminConn.query(`USE \`${CENTRAL_DB}\``);

  await adminConn.query(`
    INSERT INTO roles (name, slug, description, is_active) VALUES
      ('Super Administrator', 'super_admin',     'Full system access across all units.',     TRUE),
      ('Unit Administrator',  'unit_admin',      'Full access within their unit.',            TRUE),
      ('Employee',            'employee',        'Standard employee with visit rights.',      TRUE),
      ('Security Guard',      'security',        'Gate check-in/out management.',             TRUE),
      ('Receptionist',        'receptionist',    'Visitor registration and front-desk.',      TRUE),
      ('Global Auditor',      'global_auditor',  'Read-only access to all unit reports.',     TRUE),
      ('Unit Auditor',        'unit_auditor',    'Read-only access to own unit reports.',     TRUE)
    ON DUPLICATE KEY UPDATE name=VALUES(name);
  `);

  await adminConn.query(`
    INSERT INTO visitor_types (name, code, is_active) VALUES
      ('Employee Visit',          'EMP',               TRUE),
      ('Supplier/Vendor/AMC',     'VENDOR',            TRUE),
      ('Prior Approved External', 'PRIOR',             TRUE),
      ('Spot Walk-in',            'SPOT',              TRUE),
      ('Personal Visit',          'PERSONAL_VISIT',    TRUE),
      ('Inter-Unit Visit',        'INTER_UNIT_VISIT',  TRUE),
      ('Inter-Unit Invite',       'INTER_UNIT_INVITE', TRUE)
    ON DUPLICATE KEY UPDATE name=VALUES(name);
  `);
}

/**
 * Migrates a single unit database to the latest schema and patches.
 */
async function migrateUnitDatabase(conn, dbName) {
  const unitSchemaPath = path.join(__dirname, '../database/vms_unit_schema.sql');
  await executeSqlFile(conn, unitSchemaPath, dbName);

  // 1. Column migrations
  await addColumnIfMissing(conn, dbName, 'visit_requests', 'service_type', 'VARCHAR(100) NULL AFTER vendor_email');
  await addColumnIfMissing(conn, dbName, 'visit_requests', 'work_order_ref', 'VARCHAR(100) NULL AFTER service_type');
  // Visitor's address from the public form (tender 1.1.1)
  await addColumnIfMissing(conn, dbName, 'visit_requests', 'visitor_address', 'VARCHAR(255) NULL AFTER visitor_email');
  // Visit-day reminder already sent (services/reminder.service.js)
  await addColumnIfMissing(conn, dbName, 'visit_requests', 'reminder_sent_at', 'DATETIME NULL AFTER force_created');
  // Cross-unit EMPLOYEE_VISIT requester (lives in another unit's DB)
  await addColumnIfMissing(conn, dbName, 'visit_requests', 'cross_unit_requester_id', 'INT NULL AFTER requester_user_id');
  await addColumnIfMissing(conn, dbName, 'visit_requests', 'requester_unit_id', 'INT NULL AFTER cross_unit_requester_id');
  await addIndexIfMissing(conn, dbName, 'visit_requests', 'idx_visit_request_cross_requester', '(requester_unit_id, cross_unit_requester_id)');

  // otp_logs: otp_code holds a 64-char SHA-256 hash (was VARCHAR(10), so inserts failed)
  // and gets a wrong-guess counter (brute-force limit)
  const [otpCol] = await conn.query(
    `SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'otp_logs' AND COLUMN_NAME = 'otp_code'`,
    [dbName]
  );
  if (otpCol.length > 0 && otpCol[0].len < 64) {
    await conn.query(`ALTER TABLE \`${dbName}\`.otp_logs MODIFY COLUMN otp_code VARCHAR(64) NOT NULL`);
  }
  await addColumnIfMissing(conn, dbName, 'otp_logs', 'attempts', 'INT NOT NULL DEFAULT 0 AFTER is_used');

  // Sessions issued before the last password change/reset are rejected (auth.middleware)
  await addColumnIfMissing(conn, dbName, 'users', 'password_changed_at', 'DATETIME NULL AFTER password_hash');

  // 2. request_source ENUM update (include 'PUBLIC')
  try {
    const [cols] = await conn.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'visit_requests' AND COLUMN_NAME = 'request_source'`,
      [dbName]
    );
    if (cols.length > 0 && !cols[0].COLUMN_TYPE.includes("'PUBLIC'")) {
      await conn.query(
        `ALTER TABLE \`${dbName}\`.visit_requests
         MODIFY COLUMN request_source ENUM('SELF','RECEPTION','HOST','SYSTEM','PUBLIC') NOT NULL`
      );
    }
  } catch (_) {}

  // 3. gate_passes columns
  await addColumnIfMissing(conn, dbName, 'gate_passes', 'checkout_method', "ENUM('DIRECT','QR_SCAN') NULL AFTER status");
  await addColumnIfMissing(conn, dbName, 'gate_passes', 'qr_expires_at', 'DATETIME NULL AFTER checkout_method');
  await addColumnIfMissing(conn, dbName, 'gate_passes', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER issued_at');

  // 4. Ensure host_phone_blacklist table exists
  await conn.query(`
    CREATE TABLE IF NOT EXISTS \`${dbName}\`.host_phone_blacklist (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      host_user_id   INT NOT NULL,
      visitor_phone  VARCHAR(20)  NOT NULL,
      visitor_name   VARCHAR(120) NULL,
      reason         TEXT         NOT NULL,
      blocked_by     INT NOT NULL,
      is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
      created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_host_phone (host_user_id, visitor_phone),
      INDEX idx_phone      (visitor_phone)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 5. Drop cross-unit foreign keys that break multi-tenancy
  await dropFkIfExists(conn, dbName, 'visit_requests',   'requester_user_id');
  await dropFkIfExists(conn, dbName, 'approval_history', 'acted_by_user_id');
}

/**
 * Auto-migrates all unit databases found in the system.
 */
async function migrateAllUnitDatabases(conn) {
  const unitDbNames = new Set();

  try {
    const [registered] = await conn.query(
      `SELECT db_name FROM \`${CENTRAL_DB}\`.units WHERE db_name IS NOT NULL`
    );
    for (const r of registered) {
      if (r.db_name) unitDbNames.add(r.db_name);
    }
  } catch (_) {}

  try {
    const [schemata] = await conn.query(
      `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE 'vms_unit_%'`
    );
    for (const s of schemata) {
      if (s.SCHEMA_NAME) unitDbNames.add(s.SCHEMA_NAME);
    }
  } catch (_) {}

  for (const dbName of unitDbNames) {
    try {
      await migrateUnitDatabase(conn, dbName);
    } catch (err) {
      console.warn(`[DatabaseInit] Warning migrating unit ${dbName}: ${err.message}`);
    }
  }
}

/**
 * Main automated migration entry point.
 * Call this on server startup before handling requests.
 */
async function autoMigrate() {
  console.log('[DatabaseInit] Checking database connection and schema integrity...');
  let adminConn;

  try {
    adminConn = await mysql.createConnection({
      host:     BASE_CONFIG.host,
      port:     BASE_CONFIG.port,
      user:     BASE_CONFIG.user,
      password: BASE_CONFIG.password,
    });

    // 1. Central database & lookup seeds
    await ensureCentralDatabase(adminConn);
    console.log(`[DatabaseInit] Central database "${CENTRAL_DB}" & seed tables verified.`);

    // 2. Unit databases & schema patches
    await migrateAllUnitDatabases(adminConn);
    console.log('[DatabaseInit] All unit databases and schema patches verified.');

  } catch (err) {
    console.error('[DatabaseInit] Database auto-migration failed:', err.message);
    throw err;
  } finally {
    if (adminConn) {
      await adminConn.end();
    }
  }
}

module.exports = {
  autoMigrate,
  migrateUnitDatabase,
  ensureCentralDatabase,
};
