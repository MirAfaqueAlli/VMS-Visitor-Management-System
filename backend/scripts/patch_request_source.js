// backend/scripts/patch_request_source.js
// One-time migration: adds 'PUBLIC' to request_source ENUM in every vms_unit_* database.
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mysql = require('mysql2/promise');

async function run() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || 'localhost',
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
  });

  const [dbs] = await conn.query(
    "SELECT SCHEMA_NAME AS db FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE 'vms_unit_%'"
  );

  if (!dbs.length) {
    console.log('No vms_unit_* databases found.');
    await conn.end();
    return;
  }

  for (const { db } of dbs) {
    console.log(`\nPatching: ${db}`);

    // Check current ENUM definition
    const [cols] = await conn.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'visit_requests' AND COLUMN_NAME = 'request_source'`,
      [db]
    );

    if (!cols.length) {
      console.log(`  ⚠️  visit_requests.request_source column not found — skipping`);
      continue;
    }

    const currentType = cols[0].COLUMN_TYPE;
    if (currentType.includes("'PUBLIC'")) {
      console.log(`  ⏭️  'PUBLIC' already in ENUM — skipping`);
      continue;
    }

    // Alter to add PUBLIC to the ENUM
    await conn.query(
      `ALTER TABLE \`${db}\`.visit_requests
       MODIFY COLUMN request_source ENUM('SELF','RECEPTION','HOST','SYSTEM','PUBLIC') NOT NULL`
    );
    console.log(`  ✅ Added 'PUBLIC' to request_source ENUM`);
  }

  await conn.end();
  console.log('\n✅ All unit databases patched.');
}

run().catch(err => {
  console.error('❌ Patch failed:', err.message);
  process.exit(1);
});
