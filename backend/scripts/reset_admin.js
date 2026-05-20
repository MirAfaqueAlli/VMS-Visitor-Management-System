const bcrypt = require('bcrypt');
const mysql  = require('mysql2/promise');
require('dotenv').config();

async function resetAdminPassword() {
  const hash = await bcrypt.hash('Admin@1234', 12);
  console.log('Generated hash:', hash);

  const ok = await bcrypt.compare('Admin@1234', hash);
  console.log('Self-verify:', ok);
  if (!ok) { console.error('Hash mismatch — aborting'); return; }

  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || 'localhost',
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'vms_db',
  });

  const [rows] = await conn.execute(
    "SELECT id, email, role_type FROM users WHERE email = 'admin@sobeit.in' LIMIT 1"
  );

  if (rows.length === 0) {
    console.log('User not found — inserting...');
    const [[org]]  = await conn.execute("SELECT id FROM organizations WHERE code = 'SBTQ' LIMIT 1");
    const [[dept]] = await conn.execute("SELECT id FROM departments WHERE code = 'IT-DEPT' LIMIT 1");

    if (!org || !dept) {
      console.error('Missing org/dept — run seed_data.sql first');
      await conn.end(); return;
    }

    await conn.execute(
      `INSERT INTO users
         (organization_id, department_id, employee_code, full_name, email, phone, password_hash, designation, role_type, is_active)
       VALUES (?, ?, 'EMP-001', 'System Admin', 'admin@sobeit.in', '9000000000', ?, 'System Administrator', 'admin', 1)`,
      [org.id, dept.id, hash]
    );
    console.log('✅ User inserted successfully.');
  } else {
    console.log('User found:', rows[0]);
    // Only update password_hash — leave role_type unchanged
    await conn.execute(
      "UPDATE users SET password_hash = ?, is_active = 1 WHERE email = 'admin@sobeit.in'",
      [hash]
    );
    console.log('✅ Password updated successfully.');
  }

  await conn.end();
  console.log('\nLogin credentials:');
  console.log('  Email   : admin@sobeit.in');
  console.log('  Password: Admin@1234');
}

resetAdminPassword().catch(console.error);
