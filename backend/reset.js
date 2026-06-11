/**
 * VMS Database Reset Script — run from /backend with: node reset.js
 */
'use strict';

const mysql = require('mysql2/promise');
require('dotenv').config();

const CONFIG = {
  host:     process.env.DB_HOST     || 'localhost',
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
};

const CENTRAL = process.env.DB_CENTRAL_NAME || 'vms_central';

async function reset() {
  const conn = await mysql.createConnection(CONFIG);

  console.log('\n🔄  VMS Database Reset Starting...\n');

  // 1. Find all vms_unit_* databases
  const [schemas] = await conn.query(
    `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE 'vms_unit_%'`
  );

  // 2. Drop each unit database
  for (const row of schemas) {
    const db = row.SCHEMA_NAME;
    await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
    console.log(`  ✅  Dropped database: ${db}`);
  }

  if (schemas.length === 0) {
    console.log('  ℹ️   No unit databases found to drop.');
  }

  // 3. Clear central DB data
  await conn.query(`USE \`${CENTRAL}\``);
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');

  const tables = ['global_audit_logs', 'public_otp_logs', 'units', 'users', 'organizations'];
  for (const table of tables) {
    await conn.query(`TRUNCATE TABLE \`${table}\``);
    console.log(`  🗑️   Cleared table: ${CENTRAL}.${table}`);
  }

  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  await conn.end();

  console.log('\n✨  Reset complete!');
  console.log('    All units, branches, and super admin data removed.');
  console.log('    Restart the backend and open the app for first-time setup.\n');
}

reset().catch(err => {
  console.error('\n❌  Reset failed:', err.message);
  process.exit(1);
});
