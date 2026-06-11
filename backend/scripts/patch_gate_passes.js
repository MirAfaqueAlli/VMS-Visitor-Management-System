// backend/scripts/patch_gate_passes.js
// One-time migration: adds checkout_method + qr_expires_at + updated_at
// to gate_passes in every existing vms_unit_* database.
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mysql = require('mysql2/promise');

async function run() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || 'localhost',
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
  });

  // 1. Find all vms_unit_* databases
  const [dbs] = await conn.query(
    "SELECT SCHEMA_NAME AS db FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE 'vms_unit_%'"
  );

  if (!dbs.length) {
    console.log('No vms_unit_* databases found. Nothing to patch.');
    await conn.end();
    return;
  }

  for (const { db } of dbs) {
    console.log(`\nPatching: ${db}`);

    // checkout_method
    const [chk1] = await conn.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'gate_passes' AND COLUMN_NAME = 'checkout_method'`,
      [db]
    );
    if (chk1.length === 0) {
      await conn.query(
        `ALTER TABLE \`${db}\`.gate_passes
         ADD COLUMN checkout_method ENUM('DIRECT','QR_SCAN') NULL AFTER status`
      );
      console.log('  ✅ Added checkout_method');
    } else {
      console.log('  ⏭️  checkout_method already exists');
    }

    // qr_expires_at
    const [chk2] = await conn.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'gate_passes' AND COLUMN_NAME = 'qr_expires_at'`,
      [db]
    );
    if (chk2.length === 0) {
      await conn.query(
        `ALTER TABLE \`${db}\`.gate_passes
         ADD COLUMN qr_expires_at DATETIME NULL AFTER checkout_method`
      );
      console.log('  ✅ Added qr_expires_at');
    } else {
      console.log('  ⏭️  qr_expires_at already exists');
    }

    // updated_at
    const [chk3] = await conn.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'gate_passes' AND COLUMN_NAME = 'updated_at'`,
      [db]
    );
    if (chk3.length === 0) {
      await conn.query(
        `ALTER TABLE \`${db}\`.gate_passes
         ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER issued_at`
      );
      console.log('  ✅ Added updated_at');
    } else {
      console.log('  ⏭️  updated_at already exists');
    }
  }

  await conn.end();
  console.log('\n✅ All unit databases patched successfully.');
}

run().catch(err => {
  console.error('❌ Patch failed:', err.message);
  process.exit(1);
});
