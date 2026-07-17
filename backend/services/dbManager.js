// backend/services/dbManager.js
'use strict';

const mysql = require('mysql2/promise');
const path  = require('path');
const fs    = require('fs');
require('dotenv').config();

/**
 * DB Manager — Lazy connection pool registry for multi-database architecture.
 *
 * - Each unit/branch has its own isolated MySQL database.
 * - Pools are created on first use and cached for reuse.
 * - The central DB (vms_central) is always available.
 * - provisionUnitDb() creates a new database and runs the unit schema template.
 * - queryAllUnits() fans out a query to all active unit databases.
 */

const BASE_CONFIG = {
  host:               process.env.DB_HOST     || 'localhost',
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
};

// Registry: dbName → mysql2 Pool
const pools = new Map();

/**
 * getPool(dbName)
 * Returns a cached pool for the given database name, creating it if needed.
 */
function getPool(dbName) {
  if (!dbName || typeof dbName !== 'string') {
    throw new Error(`[DBManager] getPool() called with invalid dbName: ${dbName}`);
  }
  if (!pools.has(dbName)) {
    const pool = mysql.createPool({ ...BASE_CONFIG, database: dbName });
    pools.set(dbName, pool);
  
  }
  return pools.get(dbName);
}

// Central DB pool — always available
const CENTRAL_DB_NAME = process.env.DB_CENTRAL_NAME || 'vms_central';
const centralPool = getPool(CENTRAL_DB_NAME);

/**
 * provisionUnitDb(dbName)
 * 1. Creates the MySQL database if it doesn't exist.
 * 2. Runs the unit schema template (vms_unit_schema.sql) inside the new DB.
 * Returns the pool for the new database.
 */
async function provisionUnitDb(dbName) {


  // Step 1: Connect WITHOUT a database to run CREATE DATABASE
  const adminConn = await mysql.createConnection({
    host:     BASE_CONFIG.host,
    user:     BASE_CONFIG.user,
    password: BASE_CONFIG.password,
  });

  try {
    await adminConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  } finally {
    await adminConn.end();
  }

  // Step 2: Get (or create) a pool for the new DB
  const unitPool = getPool(dbName);

  // Step 3: Run the unit schema template using a robust line-by-line parser.
  // The old approach (split on /;\s*\n/) broke on Windows CRLF line endings
  // and on semicolons inside string literals. This parser matches mysql CLI behaviour.
  const schemaPath = path.join(__dirname, '../database/vms_unit_schema.sql');
  const rawSql     = fs.readFileSync(schemaPath, 'utf8');

  // Normalise line endings — CRLF → LF so the parser works on Windows too
  const lines = rawSql.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  const statements = [];
  let buffer = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip blank lines and full-line comments
    if (!line || line.startsWith('--')) continue;

    buffer += (buffer ? '\n' : '') + line;

    // A statement ends when the line (after trimming) ends with a semicolon.
    // Edge-case: DELIMITER changes are not used in our schema — safe to ignore.
    if (line.endsWith(';')) {
      const stmt = buffer.trim();
      if (stmt && stmt !== ';') {
        statements.push(stmt);
      }
      buffer = '';
    }
  }

  // Flush any trailing statement without a trailing semicolon
  if (buffer.trim()) {
    statements.push(buffer.trim());
  }

  const conn = await unitPool.getConnection();
  try {
    for (const stmt of statements) {
      await conn.query(stmt);
    }

  } finally {
    conn.release();
  }

  return unitPool;
}

/**
 * queryAllUnits(sql, params)
 * Fans out a SQL query to ALL active unit databases.
 * Returns an array of { unit_db, unit_name, rows } objects.
 * Failed queries are skipped (not thrown).
 */
async function queryAllUnits(sql, params = []) {
  const [units] = await centralPool.query(
    `SELECT db_name, name AS unit_name FROM units WHERE is_active = 1 AND db_status = 'ACTIVE'`
  );

  const results = await Promise.allSettled(
    units.map(async (unit) => {
      const pool = getPool(unit.db_name);
      const [rows] = await pool.query(sql, params);
      return { unit_db: unit.db_name, unit_name: unit.unit_name, rows };
    })
  );

  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
}

/**
 * closeAll()
 * Gracefully ends all open pools. Call on process exit.
 */
async function closeAll() {
  for (const [dbName, pool] of pools.entries()) {
    try {
      await pool.end();
   
    } catch (err) {
      console.error(`[DBManager] Error closing pool for ${dbName}:`, err.message);
    }
  }
}

module.exports = { getPool, centralPool, CENTRAL_DB_NAME, provisionUnitDb, queryAllUnits, closeAll };
