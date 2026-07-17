// backend/scripts/seed_unit.js
// Usage: node scripts/seed_unit.js --code=BR01 --name="Branch Office" --city="Delhi"
'use strict';

const fs   = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=')]; })
);

const code    = (args.code   || 'BR01').toUpperCase();
const name    = args.name    || 'Branch Office';
const city    = args.city    || 'Unknown';
const prefix  = process.env.UNIT_DB_PREFIX || 'vms_unit_';
const dbName  = `${prefix}${code.toLowerCase()}`;

const DB_CONFIG = {
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '3306'),
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  multipleStatements: true,
};
const CENTRAL_DB = process.env.DB_CENTRAL_NAME || 'vms_central';

async function seedUnit() {
  console.log(`\n⚙  Provisioning unit: ${code} → ${dbName}\n`);
  let conn;
  try {
    conn = await mysql.createConnection(DB_CONFIG);

    // 1. Check if unit code already exists
    const [exists] = await conn.query(
      `SELECT id FROM \`${CENTRAL_DB}\`.units WHERE code = ?`, [code]
    );
    if (exists.length > 0) {
      console.error(`❌ Unit code "${code}" already exists in central registry.`);
      process.exit(1);
    }

    // 2. Create DB
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await conn.query(`USE \`${dbName}\``);

    // 3. Apply schema
    const schemaPath = path.join(__dirname, '../database/vms_unit_schema.sql');
    if (!fs.existsSync(schemaPath)) {
      console.error('❌ vms_unit_schema.sql not found at:', schemaPath);
      process.exit(1);
    }
    await conn.query(fs.readFileSync(schemaPath, 'utf8'));
    console.log(`✅ Schema applied to ${dbName}`);

    // 4. Register in central
    const [orgRows] = await conn.query(
      `SELECT id FROM \`${CENTRAL_DB}\`.organizations LIMIT 1`
    );
    const orgId = orgRows[0]?.id ?? 1;

    await conn.query(`
      INSERT INTO \`${CENTRAL_DB}\`.units
        (organization_id, name, code, type, db_name, db_status, city, is_active)
      VALUES (?, ?, ?, 'BRANCH', ?, 'ACTIVE', ?, 1)
    `, [orgId, name, code, dbName, city]);

    const [unitRows] = await conn.query(
      `SELECT id FROM \`${CENTRAL_DB}\`.units WHERE code = ? LIMIT 1`, [code]
    );
    const unitId = unitRows[0]?.id ?? 1;
    console.log(`✅ Unit registered in central (id=${unitId})`);

    // 5. Seed default department + admin
    await conn.query(`USE \`${dbName}\``);
    await conn.query(`
      INSERT IGNORE INTO departments (unit_id, name, code, is_active)
      VALUES (${unitId}, 'Administration', 'ADMIN', 1)
    `);
    const [deptRows] = await conn.query(
      `SELECT id FROM departments WHERE code = 'ADMIN' LIMIT 1`
    );
    const deptId = deptRows[0]?.id ?? 1;

    await conn.query(`
      INSERT IGNORE INTO designations (department_id, name) VALUES (${deptId}, 'Manager')
    `);
    const [desigRows] = await conn.query(`SELECT id FROM designations LIMIT 1`);
    const desigId = desigRows[0]?.id ?? 1;

    // Password: Admin@1234
    const passwordHash = '$2b$12$2YBXEPTPXZJsxPFg3UF/n.3cH.RYnwDtao6BXznaVfNjP.R6yiP4K';
    const empCode = `${code}-ADM-001`;
    const email   = `admin@${code.toLowerCase()}.vms`;

    await conn.query(`
      INSERT IGNORE INTO users
        (unit_id, department_id, designation_id, role_type, full_name, email, phone,
         password_hash, employee_code, is_active)
      VALUES
        (${unitId}, ${deptId}, ${desigId}, 'unit_admin',
         '${name} Admin', '${email}', NULL,
         '${passwordHash}', '${empCode}', 1)
    `);

 

  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

seedUnit();
