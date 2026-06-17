// backend/scripts/reset_db.js
// ──────────────────────────────────────────────────────────────────────────────
// Full clean reset for VMS.
//
// What this does:
//   1. Discovers unit DBs from TWO sources:
//      (a) Registered names in vms_central.units (if central is intact)
//      (b) ALL databases matching 'vms_unit_%' in information_schema (catches orphans)
//   2. Drops every discovered unit database (deduplicated)
//   3. Drops and fully recreates vms_central (schema + lookup seed only)
//   4. Leaves the system in "uninitialized" state
//
// After running this, go to http://localhost:5173/setup to:
//   • Register your organization
//   • Create your Super Admin account
//   • Then log in and create units, departments and users from the dashboard
//
// Run with:
//   node backend/scripts/reset_db.js
//   -- or --
//   npm run reset-db        (if added to package.json scripts)
// ──────────────────────────────────────────────────────────────────────────────
'use strict';

const fs    = require('fs');
const path  = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DB_CONFIG = {
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '3306', 10),
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  multipleStatements: true,
};

const CENTRAL_DB = process.env.DB_CENTRAL_NAME || 'vms_central';

// ── Pretty logger ──────────────────────────────────────────────────────────────
const ok   = (msg) => console.log(`  ✅  ${msg}`);
const info = (msg) => console.log(`  ℹ   ${msg}`);
const drop = (msg) => console.log(`  🗑   ${msg}`);
const warn = (msg) => console.log(`  ⚠   ${msg}`);
const err  = (msg) => console.error(`  ❌  ${msg}`);

// ── Fetch all unit DB names registered in vms_central ────────────────────────
async function getRegisteredUnitDbs(conn) {
  try {
    const [rows] = await conn.query(
      `SELECT db_name FROM \`${CENTRAL_DB}\`.units WHERE db_name IS NOT NULL`
    );
    return rows.map(r => r.db_name).filter(Boolean);
  } catch {
    return []; // central DB may not exist yet — that's fine
  }
}

// ── Discover ALL vms_unit_* databases via information_schema (catches orphans) ─
async function getAllUnitDbs(conn) {
  try {
    const [rows] = await conn.query(
      `SELECT SCHEMA_NAME AS db_name
       FROM information_schema.SCHEMATA
       WHERE SCHEMA_NAME LIKE 'vms_unit_%'`
    );
    return rows.map(r => r.db_name).filter(Boolean);
  } catch {
    return [];
  }
}

// ── Apply schema file (strips the SEED DATA section) ─────────────────────────
async function applySchema(conn, filePath) {
  if (!fs.existsSync(filePath)) {
    warn(`Schema file not found, skipping: ${path.basename(filePath)}`);
    return;
  }
  let sql = fs.readFileSync(filePath, 'utf8');

  // Strip everything from "-- ── SEED DATA" onward so no org / user is inserted.
  // The roles + visitor_types lookup INSERTs are placed BEFORE that marker
  // in the schema file and will still be applied.
  const seedMarker = sql.indexOf('-- ── SEED DATA');
  if (seedMarker !== -1) {
    sql = sql.substring(0, seedMarker).trimEnd() + '\n';
    info('Seed data section stripped — tables will be empty.');
  }

  await conn.query(sql);
  ok(`Schema applied: ${path.basename(filePath)}`);
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        VMS — Full Database Reset & Clean Start               ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  let conn;
  try {
    conn = await mysql.createConnection(DB_CONFIG);
    ok(`Connected to MySQL at ${DB_CONFIG.host}:${DB_CONFIG.port}`);
    console.log('');

    // ── Step 1: Discover and drop ALL unit databases ─────────────────────────
    // Two sources are combined to ensure no orphaned databases are left behind:
    //   (a) Registered names in vms_central.units  — works when central DB is intact
    //   (b) information_schema LIKE 'vms_unit_%'   — catches orphans when central is gone
    console.log('[ 1 / 3 ]  Dropping unit databases…');
    const registeredDbs = await getRegisteredUnitDbs(conn);
    const allSchemaDbs  = await getAllUnitDbs(conn);

    // Merge and deduplicate
    const unitDbSet = new Set([...registeredDbs, ...allSchemaDbs]);

    if (unitDbSet.size === 0) {
      info('No unit databases found — nothing to drop.');
    } else {
      info(`Found ${registeredDbs.length} registered + ${allSchemaDbs.length} discovered via schema = ${unitDbSet.size} unique unit DB(s) to drop.`);
      for (const dbName of unitDbSet) {
        await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
        drop(`Dropped unit DB: ${dbName}`);
      }
      ok(`${unitDbSet.size} unit database(s) removed.`);
    }
    console.log('');


    // ── Step 2: Drop and recreate vms_central ────────────────────────────────
    console.log(`[ 2 / 3 ]  Recreating central database: ${CENTRAL_DB}…`);
    await conn.query(`DROP DATABASE IF EXISTS \`${CENTRAL_DB}\``);
    drop(`Dropped central DB: ${CENTRAL_DB}`);

    await conn.query(
      `CREATE DATABASE \`${CENTRAL_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    ok(`Created fresh central DB: ${CENTRAL_DB}`);

    await conn.query(`USE \`${CENTRAL_DB}\``);

    const centralSchemaPath = path.join(__dirname, '../database/vms_central_schema.sql');
    await applySchema(conn, centralSchemaPath);
    console.log('');

    // ── Step 3: Verify clean state ───────────────────────────────────────────
    console.log('[ 3 / 3 ]  Verifying clean state…');

    const checks = [
      { table: 'organizations', label: 'Organizations' },
      { table: 'units',         label: 'Units'         },
      { table: 'users',         label: 'Users'         },
    ];

    let allClean = true;
    for (const { table, label } of checks) {
      const [[{ cnt }]] = await conn.query(
        `SELECT COUNT(*) AS cnt FROM \`${CENTRAL_DB}\`.\`${table}\``
      );
      if (Number(cnt) === 0) {
        ok(`${label}: empty ✓`);
      } else {
        warn(`${label}: ${cnt} row(s) found — check schema seed section`);
        allClean = false;
      }
    }

    // Lookup tables (roles, visitor_types) should have rows — that's correct
    const [[{ roleCnt }]] = await conn.query(
      `SELECT COUNT(*) AS roleCnt FROM \`${CENTRAL_DB}\`.roles`
    );
    ok(`Roles lookup table: ${roleCnt} role(s) seeded`);

    const [[{ vtCnt }]] = await conn.query(
      `SELECT COUNT(*) AS vtCnt FROM \`${CENTRAL_DB}\`.visitor_types`
    );
    ok(`Visitor types lookup: ${vtCnt} type(s) seeded`);

    console.log('');

    // ── Done ─────────────────────────────────────────────────────────────────
    if (allClean) {
      console.log('╔══════════════════════════════════════════════════════════════╗');
      console.log('║  ✅  Clean reset complete — system is in fresh state!         ║');
      console.log('║                                                              ║');
      console.log('║  To start the system:                                        ║');
      console.log('║                                                              ║');
      console.log('║  1. Start the backend:                                       ║');
      console.log('║       cd backend && npm run dev                              ║');
      console.log('║                                                              ║');
      console.log('║  2. Start the frontend:                                      ║');
      console.log('║       cd frontend && npm run dev                             ║');
      console.log('║                                                              ║');
      console.log('║  3. Open in browser:                                         ║');
      console.log('║       http://localhost:5173/setup                            ║');
      console.log('║                                                              ║');
      console.log('║  4. On the setup page:                                       ║');
      console.log('║       • Enter your Organization name & code                  ║');
      console.log('║       • Create your Super Admin account (email + password)   ║');
      console.log('║       • Click "Initialize System"                            ║');
      console.log('║                                                              ║');
      console.log('║  5. Log in at http://localhost:5173/login                    ║');
      console.log('║       Then create units, departments, and users.             ║');
      console.log('╚══════════════════════════════════════════════════════════════╝');
    } else {
      console.log('╔══════════════════════════════════════════════════════════════╗');
      console.log('║  ⚠   Reset completed with warnings — see output above.       ║');
      console.log('╚══════════════════════════════════════════════════════════════╝');
    }
    console.log('');

  } catch (e) {
    console.log('');
    err(`Reset failed: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

main();
