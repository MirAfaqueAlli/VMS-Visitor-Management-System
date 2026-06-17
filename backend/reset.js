/**
 * VMS Database Reset Script
 * Run from /backend with:  node reset.js
 *
 * What this does:
 *   1. Reads all registered unit DB names from vms_central.units
 *   2. Drops every vms_unit_* database
 *   3. Drops and fully RECREATES vms_central from the schema file
 *      (roles + visitor_types lookup data are re-seeded automatically)
 *   4. Leaves the system in clean "first-time setup" state
 *
 * After running: restart the backend, then open /setup in the browser.
 */
'use strict';

const fs    = require('fs');
const path  = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const CONFIG = {
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '3306', 10),
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  multipleStatements: true,
};

const CENTRAL = process.env.DB_CENTRAL_NAME || 'vms_central';

// ── Pretty logger ─────────────────────────────────────────────────────────────
const ok   = (msg) => console.log(`  ✅  ${msg}`);
const info = (msg) => console.log(`  ℹ   ${msg}`);
const drop = (msg) => console.log(`  🗑   ${msg}`);

async function reset() {
  const conn = await mysql.createConnection(CONFIG);

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        VMS — Full Database Reset & Clean Start               ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // ── Step 1: Discover all unit DBs from central (before we drop it) ──────────
  console.log('[ 1 / 3 ]  Dropping unit databases…');
  let unitDbs = [];
  try {
    const [rows] = await conn.query(
      `SELECT db_name FROM \`${CENTRAL}\`.units WHERE db_name IS NOT NULL`
    );
    unitDbs = rows.map(r => r.db_name);
  } catch {
    info('Could not read unit list from central (may not exist yet) — skipping.');
  }

  // Also scan information_schema for any vms_unit_* databases not in the registry
  const [schemaRows] = await conn.query(
    `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE 'vms_unit_%'`
  );
  const schemaNames = schemaRows.map(r => r.SCHEMA_NAME);
  const allUnitDbs  = [...new Set([...unitDbs, ...schemaNames])];

  if (allUnitDbs.length === 0) {
    info('No unit databases found — nothing to drop.');
  } else {
    for (const db of allUnitDbs) {
      await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
      drop(`Dropped unit DB: ${db}`);
    }
    ok(`${allUnitDbs.length} unit database(s) removed.`);
  }
  console.log('');

  // ── Step 2: Drop and fully RECREATE vms_central ─────────────────────────────
  console.log(`[ 2 / 3 ]  Recreating central database: ${CENTRAL}…`);
  await conn.query(`DROP DATABASE IF EXISTS \`${CENTRAL}\``);
  drop(`Dropped central DB: ${CENTRAL}`);

  await conn.query(
    `CREATE DATABASE \`${CENTRAL}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  ok(`Created fresh: ${CENTRAL}`);

  await conn.query(`USE \`${CENTRAL}\``);

  // Apply schema (includes roles + visitor_types seed data)
  const schemaPath = path.join(__dirname, 'database/vms_central_schema.sql');
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Central schema file not found: ${schemaPath}`);
  }
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await conn.query(schemaSql);
  ok(`Schema applied: vms_central_schema.sql`);
  console.log('');

  // ── Step 3: Verify clean state ───────────────────────────────────────────────
  console.log('[ 3 / 3 ]  Verifying clean state…');

  const [[{ orgCount }]]   = await conn.query(`SELECT COUNT(*) AS orgCount   FROM organizations`);
  const [[{ userCount }]]  = await conn.query(`SELECT COUNT(*) AS userCount   FROM users`);
  const [[{ unitCount }]]  = await conn.query(`SELECT COUNT(*) AS unitCount   FROM units`);
  const [[{ roleCnt }]]    = await conn.query(`SELECT COUNT(*) AS roleCnt     FROM roles`);
  const [[{ vtCnt }]]      = await conn.query(`SELECT COUNT(*) AS vtCnt       FROM visitor_types`);

  if (Number(orgCount)  === 0) ok('Organizations: empty ✓'); else console.log(`  ⚠   Organizations: ${orgCount} rows (unexpected)`);
  if (Number(userCount) === 0) ok('Users: empty ✓');         else console.log(`  ⚠   Users: ${userCount} rows (unexpected)`);
  if (Number(unitCount) === 0) ok('Units: empty ✓');         else console.log(`  ⚠   Units: ${unitCount} rows (unexpected)`);
  ok(`Roles lookup: ${roleCnt} roles seeded`);
  ok(`Visitor types lookup: ${vtCnt} types seeded`);

  await conn.end();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  ✅  Clean reset complete — system is in fresh state!         ║');
  console.log('║                                                              ║');
  console.log('║  IMPORTANT: Restart the backend server before setup!         ║');
  console.log('║                                                              ║');
  console.log('║  1. Restart backend:  cd backend && npm run dev              ║');
  console.log('║  2. Open browser:     http://localhost:5173/setup            ║');
  console.log('║  3. Register org + create Super Admin                        ║');
  console.log('║  4. Log in, create units, departments, and users             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
}

reset().catch(err => {
  console.error('\n❌  Reset failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
