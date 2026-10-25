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
  host:               process.env.DB_HOST     ,
  port:               parseInt(process.env.DB_PORT || '3306', 10),
  user:               process.env.DB_USER     ,
  password:           process.env.DB_PASSWORD || process.env.DB_PASS || '',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
};

// Registry: dbName → mysql2 Pool
const pools = new Map();

// Every session runs in IST so NOW() / CURDATE() match the app's "today"
// (server.js pins the Node process to IST too). Override with DB_SESSION_TIMEZONE.
const DB_SESSION_TIMEZONE = process.env.DB_SESSION_TIMEZONE || '+05:30';

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
    // Runs on each new physical connection, queued before any query that uses it
    pool.on('connection', (conn) => {
      conn.query('SET time_zone = ?', [DB_SESSION_TIMEZONE], (err) => {
        if (err) console.error(`[DBManager] Failed to set time_zone for ${dbName}:`, err.message);
      });
    });
    pools.set(dbName, pool);
  }
  return pools.get(dbName);
}

// Central DB pool — always available
const CENTRAL_DB_NAME = process.env.DB_CENTRAL_NAME || 'vms_central';
const centralPool = getPool(CENTRAL_DB_NAME);

/**
 * getActiveUnitPoolByDbName(dbName)
 * Returns the pool for dbName only if it belongs to an active unit in the
 * central registry, otherwise null. Use this for any DB name that comes from a
 * request (header / query string) — getPool() trusts its input and would open
 * a new pool for any database the MySQL user can reach.
 */
async function getActiveUnitPoolByDbName(dbName) {
  if (!dbName || typeof dbName !== 'string') return null;
  const [rows] = await centralPool.query(
    "SELECT db_name FROM units WHERE db_name = ? AND is_active = 1 AND db_status = 'ACTIVE' LIMIT 1",
    [dbName]
  );
  return rows.length ? getPool(rows[0].db_name) : null;
}

/**
 * provisionUnitDb(dbName)
 * 1. Creates the MySQL database if it doesn't exist.
 * 2. Runs the unit schema template (vms_unit_schema.sql) inside the new DB.
 * Returns the pool for the new database.
 */
async function provisionUnitDb(dbName) {

  const adminConn = await mysql.createConnection({
    host:     BASE_CONFIG.host,
    port:     BASE_CONFIG.port,
    user:     BASE_CONFIG.user,
    password: BASE_CONFIG.password,
  });

  try {
    await adminConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    const { migrateUnitDatabase } = require('./databaseInit.service');
    await migrateUnitDatabase(adminConn, dbName);
  } finally {
    await adminConn.end();
  }

  return getPool(dbName);
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

module.exports = {
  getPool, getActiveUnitPoolByDbName, centralPool, CENTRAL_DB_NAME,
  provisionUnitDb, queryAllUnits, closeAll,
};
