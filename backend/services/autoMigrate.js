// backend/services/autoMigrate.js
// ──────────────────────────────────────────────────────────────────────────────
// Automatic schema migration on server startup.
//
// Ensures every table defined in the schema SQL files exists in:
//   1. The central database (vms_central)
//   2. Every active unit database (vms_unit_*)
//
// Uses CREATE TABLE IF NOT EXISTS + INSERT … ON DUPLICATE KEY UPDATE,
// so it is safe to run on every boot — nothing is dropped or overwritten.
// ──────────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const { centralPool, getPool, CENTRAL_DB_NAME } = require('./dbManager');

// ── SQL parser ────────────────────────────────────────────────────────────────
// Splits a .sql file into individual statements, handling multi-line
// statements and stripping comments. Identical logic to provisionUnitDb().
function parseSqlFile(filePath) {
  if (!fs.existsSync(filePath)) return [];

  const raw   = fs.readFileSync(filePath, 'utf8');
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

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
  return statements;
}

// ── Execute statements on a pool, skipping failures gracefully ────────────────
async function runStatements(pool, statements, label) {
  let applied = 0;
  let skipped = 0;

  const conn = await pool.getConnection();
  try {
    for (const stmt of statements) {
      try {
        await conn.query(stmt);
        applied++;
      } catch (err) {
        // ER_TABLE_EXISTS_ERROR, ER_DUP_ENTRY, ER_DUP_KEYNAME etc. are expected
        // when tables/indexes/seed data already exist — skip silently.
        const safeErrors = [
          'ER_TABLE_EXISTS_ERROR',
          'ER_DUP_ENTRY',
          'ER_DUP_KEYNAME',
          'ER_CANT_DROP_FIELD_OR_KEY',
          'ER_DUP_INDEX',
        ];
        if (safeErrors.includes(err.code)) {
          skipped++;
        } else {
          console.warn(`[AutoMigrate] [${label}] Statement warning:`, err.code, '-', err.message.slice(0, 120));
          skipped++;
        }
      }
    }
  } finally {
    conn.release();
  }
  return { applied, skipped };
}

// ── Main entry point — called once on server boot ─────────────────────────────
async function runAutoMigrate() {
  const startTime = Date.now();
  console.log('[AutoMigrate] Checking database schemas…');

  // ── 1. Central database ─────────────────────────────────────────────────────
  const centralSchemaPath = path.join(__dirname, '../database/vms_central_schema.sql');
  const centralStmts = parseSqlFile(centralSchemaPath);

  if (centralStmts.length > 0) {
    try {
      const { applied, skipped } = await runStatements(centralPool, centralStmts, CENTRAL_DB_NAME);
      console.log(`[AutoMigrate] Central DB (${CENTRAL_DB_NAME}): ${applied} statement(s) executed, ${skipped} skipped.`);
    } catch (err) {
      console.error(`[AutoMigrate] Central DB migration failed:`, err.message);
      // Don't throw — let the server continue; the tables probably exist already.
    }
  } else {
    console.warn('[AutoMigrate] Central schema file not found or empty — skipping.');
  }

  // ── 2. All active unit databases ────────────────────────────────────────────
  const unitSchemaPath = path.join(__dirname, '../database/vms_unit_schema.sql');
  const unitStmts = parseSqlFile(unitSchemaPath);

  if (unitStmts.length === 0) {
    console.warn('[AutoMigrate] Unit schema file not found or empty — skipping unit migrations.');
  } else {
    try {
      const [units] = await centralPool.query(
        `SELECT db_name, name FROM units WHERE is_active = 1 AND db_status = 'ACTIVE'`
      );

      if (units.length === 0) {
        console.log('[AutoMigrate] No active unit databases found — nothing to migrate.');
      } else {
        let totalApplied = 0;
        let totalSkipped = 0;

        for (const unit of units) {
          try {
            const unitPool = getPool(unit.db_name);
            const { applied, skipped } = await runStatements(unitPool, unitStmts, unit.db_name);
            totalApplied += applied;
            totalSkipped += skipped;
          } catch (err) {
            console.error(`[AutoMigrate] Unit "${unit.name}" (${unit.db_name}) failed:`, err.message);
          }
        }

        console.log(
          `[AutoMigrate] ${units.length} unit DB(s): ${totalApplied} statement(s) executed, ${totalSkipped} skipped.`
        );
      }
    } catch (err) {
      // If the units table doesn't exist yet (fresh install), just skip.
      if (err.code === 'ER_NO_SUCH_TABLE') {
        console.log('[AutoMigrate] Units table not found yet (fresh install) — skipping unit migrations.');
      } else {
        console.error('[AutoMigrate] Failed to query unit databases:', err.message);
      }
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(`[AutoMigrate] Schema check complete in ${elapsed}ms.`);
}

module.exports = { runAutoMigrate };
