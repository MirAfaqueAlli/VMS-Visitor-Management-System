// backend/services/databaseInit.service.js
'use strict';

const fs    = require('fs');
const path  = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

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

  // ── Migration 002: Login lockout columns (central users table) ──────────────
  await addColumnIfMissing(
    adminConn, CENTRAL_DB, 'users', 'failed_attempts',
    'TINYINT UNSIGNED NOT NULL DEFAULT 0'
  );
  await addColumnIfMissing(
    adminConn, CENTRAL_DB, 'users', 'locked_until',
    'DATETIME NULL'
  );

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

  // 6. Migration 002: Login lockout columns (unit users table)
  await addColumnIfMissing(
    conn, dbName, 'users', 'failed_attempts',
    'TINYINT UNSIGNED NOT NULL DEFAULT 0'
  );
  await addColumnIfMissing(
    conn, dbName, 'users', 'locked_until',
    'DATETIME NULL'
  );
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
 * runPendingMigrations — auto-applies every .sql file in backend/migrations/
 * that has not yet been recorded in vms_central.schema_migrations.
 *
 * Rules:
 *  - Files are processed in ascending filename order (001_, 002_, etc.)
 *  - Each file is executed once and recorded; subsequent server restarts skip it
 *  - The tracking table is created automatically if it does not exist
 *  - Each migration runs with FOREIGN_KEY_CHECKS=0 to avoid ordering issues
 *  - A failed migration is logged as a WARNING and does NOT crash the server
 *    (addColumnIfMissing guards in the hardcoded section still act as a safety net)
 */
async function runPendingMigrations(conn) {
  // 1. Ensure tracking table exists in central DB
  await conn.query(`USE \`${CENTRAL_DB}\``);
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      filename     VARCHAR(255) NOT NULL UNIQUE,
      applied_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      checksum     VARCHAR(64)  NULL      -- reserved for future integrity check
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 2. Read all .sql files in migrations/ directory sorted by name
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log('[DatabaseInit] No migrations/ directory found — skipping.');
    return;
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort(); // alphabetical = chronological because of 001_, 002_ prefix

  if (files.length === 0) {
    console.log('[DatabaseInit] No migration files found in migrations/.');
    return;
  }

  // 3. Load already-applied filenames
  const [appliedRows] = await conn.query(
    `SELECT filename FROM \`${CENTRAL_DB}\`.schema_migrations`
  );
  const applied = new Set(appliedRows.map(r => r.filename));

  // 4. Run each pending migration
  for (const filename of files) {
    if (applied.has(filename)) {
      console.log(`[DatabaseInit] Migration already applied: ${filename}`);
      continue;
    }

    const filePath = path.join(MIGRATIONS_DIR, filename);
    console.log(`[DatabaseInit] Applying migration: ${filename}`);

    try {
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');

      // Read and execute the SQL file statement-by-statement
      const rawSql    = fs.readFileSync(filePath, 'utf8');
      const lines     = rawSql.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      const statements = [];
      let buffer = '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('--')) continue;
        buffer += (buffer ? '\n' : '') + line;
        if (line.endsWith(';')) {
          const stmt = buffer.trim();
          if (stmt && stmt !== ';') statements.push(stmt);
          buffer = '';
        }
      }
      if (buffer.trim()) statements.push(buffer.trim());

      for (const stmt of statements) {
        try {
          await conn.query(stmt);
        } catch (stmtErr) {
          // errno 1060 = column already exists — safe to ignore (idempotent)
          if (stmtErr.errno === 1060 || stmtErr.errno === 1061 || stmtErr.errno === 1050) {
            console.log(`  [DatabaseInit] Skipping (already exists): ${stmtErr.message.split("\n")[0]}`);
            continue;
          }
          throw stmtErr;
        }
      }

      await conn.query('SET FOREIGN_KEY_CHECKS = 1');

      // Record the migration as applied
      await conn.query(
        `INSERT INTO \`${CENTRAL_DB}\`.schema_migrations (filename) VALUES (?)`,
        [filename]
      );
      console.log(`[DatabaseInit] ✅ Migration applied: ${filename}`);

    } catch (err) {
      await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
      console.error(`[DatabaseInit] ❌ Migration FAILED: ${filename} — ${err.message}`);
      // Do NOT throw — let server start; hardcoded addColumnIfMissing is the safety net
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

    // 2. Auto-run all pending .sql files from backend/migrations/ (idempotent)
    await runPendingMigrations(adminConn);
    console.log('[DatabaseInit] Pending SQL migrations applied.');

    // 3. Unit databases & schema patches
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
