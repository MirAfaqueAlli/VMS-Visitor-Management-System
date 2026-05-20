const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function resetDatabase() {
  console.log('🚀 Starting fresh database setup...');

  const config = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  };

  let conn;
  try {
    conn = await mysql.createConnection(config);
    console.log('✅ Connected to MySQL Server');

    // 1. Drop and recreate DB
    console.log('🗑️ Dropping existing database and recreating...');
    await conn.query(`DROP DATABASE IF EXISTS vms_db;`);
    await conn.query(`CREATE DATABASE vms_db;`);
    await conn.query(`USE vms_db;`);

    // 2. Read and run schema
    const schemaPath = path.join(__dirname, '../../database/vms_schema.sql');
    if (fs.existsSync(schemaPath)) {
      console.log('📄 Running vms_schema.sql...');
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      await conn.query(schemaSql);
      console.log('✅ Base schema applied');
    }

    // 3. Read and run SaaS migration
    const migratePath = path.join(__dirname, '../../database/migrate_saas.sql');
    if (fs.existsSync(migratePath)) {
      console.log('📄 Running migrate_saas.sql...');
      const migrateSql = fs.readFileSync(migratePath, 'utf8');
      await conn.query(migrateSql);
      console.log('✅ SaaS Migration applied');
    }

    console.log('🎉 Database is completely fresh! Ready for first organization setup.');
  } catch (error) {
    console.error('❌ Failed to reset database:', error.message);
  } finally {
    if (conn) {
      await conn.end();
    }
  }
}

resetDatabase();
