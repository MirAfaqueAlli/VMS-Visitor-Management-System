const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function runMigration() {
  console.log('🚀 Starting VMS SaaS Migration tool...');

  // 1. Resolve migration file path
  const sqlPath = path.join(__dirname, '../../database/migrate_saas.sql');
  if (!fs.existsSync(sqlPath)) {
    console.error(`❌ Migration file not found at: ${sqlPath}`);
    process.exit(1);
  }

  console.log(`📄 Found migration script: ${sqlPath}`);
  const sqlContent = fs.readFileSync(sqlPath, 'utf8');

  // 2. Read DB Credentials from env
  const config = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'vms_db',
    multipleStatements: true, // Crucial for running multi-statement files
  };

  console.log(`🔌 Connecting to database [${config.database}] on [${config.host}] as [${config.user}]...`);

  let conn;
  try {
    conn = await mysql.createConnection(config);
    console.log('✅ Connected to MySQL successfully!');
  } catch (error) {
    console.error('❌ Failed to connect to MySQL database:', error.message);
    console.log('\nPlease verify your database connection settings in backend/.env:');
    console.log(`  DB_HOST:     ${process.env.DB_HOST}`);
    console.log(`  DB_USER:     ${process.env.DB_USER}`);
    console.log(`  DB_NAME:     ${process.env.DB_NAME}`);
    console.log(`  DB_PASSWORD: ${process.env.DB_PASSWORD ? '********' : '(empty)'}`);
    process.exit(1);
  }

  // 3. Execute Migration
  try {
    console.log('⏳ Running migration script (this may take a few seconds)...');
    await conn.query(sqlContent);
    console.log('🎉 Migration applied successfully!');

    // 4. Run verification queries to check the resulting schema
    console.log('\n🔍 Verifying applied changes...');
    
    // Check if role_type has updated ENUM values in users table
    const [cols] = await conn.query("SHOW COLUMNS FROM users LIKE 'role_type'");
    if (cols && cols.length > 0) {
      console.log(`  - users.role_type type: ${cols[0].Type}`);
    }

    // Check if visitor_documents table was created successfully
    const [tables] = await conn.query("SHOW TABLES LIKE 'visitor_documents'");
    if (tables && tables.length > 0) {
      console.log('  - visitor_documents table: Created successfully');
    } else {
      console.warn('  - visitor_documents table: Not found!');
    }

    // Check if new columns exist on visit_requests
    const [colCheck] = await conn.query("SHOW COLUMNS FROM visit_requests LIKE 'company_name'");
    if (colCheck && colCheck.length > 0) {
      console.log('  - visit_requests.company_name column: Added successfully');
    }

  } catch (error) {
    console.error('❌ Migration failed during execution:', error.message);
    process.exit(1);
  } finally {
    if (conn) {
      await conn.end();
      console.log('🔌 Database connection closed.');
    }
  }
}

runMigration();
