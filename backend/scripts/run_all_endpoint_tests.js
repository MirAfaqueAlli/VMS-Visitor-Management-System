// backend/scripts/run_all_endpoint_tests.js
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const http = require('http');
const jwt = require('jsonwebtoken');

// Import Express app
const express = require('express');

async function main() {
  console.log('================================================================');
  console.log('   VMS COMPREHENSIVE ENDPOINT VERIFICATION & TEST SUITE');
  console.log('================================================================\n');

  // Load the configured server app
  // We require the routes and build an app on an ephemeral port
  // or require server.js directly
  let app;
  try {
    // To avoid port conflict with 5001 if already running, let's load server routes onto a test server
    const express = require('express');
    const cors = require('cors');
    const helmet = require('helmet');
    
    app = express();
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Mount all routes exactly as in server.js
    app.use('/api/setup', require('../routes/setup.routes'));
    app.use('/api/auth', require('../routes/auth.routes'));
    app.use('/api/visitors', require('../routes/visitor.routes'));
    app.use('/api/visit-requests', require('../routes/visitRequest.routes'));
    app.use('/api/approvals', require('../routes/approval.routes'));
    app.use('/api/otp', require('../routes/otp.routes'));
    app.use('/api/gate', require('../routes/gate.routes'));
    app.use('/api/passes', require('../routes/gatePass.routes'));
    app.use('/api/users', require('../routes/user.routes'));
    app.use('/api/reports', require('../routes/report.routes'));
    app.use('/api/departments', require('../routes/department.routes'));
    app.use('/api/organizations', require('../routes/organization.routes'));
    app.use('/api/units', require('../routes/unit.routes'));
    app.use('/api/designations', require('../routes/designation.routes'));
    app.use('/api/central-users', require('../routes/centralUser.routes'));
    app.use('/api/public-auth', require('../routes/publicAuth.routes'));

    app.get('/api/health', async (req, res) => {
      try {
        const { centralPool } = require('../services/dbManager');
        await centralPool.query('SELECT 1');
        res.status(200).json({ status: 'OK', message: 'Central DB connected' });
      } catch (err) {
        res.status(500).json({ status: 'ERROR', message: err.message });
      }
    });

  } catch (err) {
    console.error('Failed to initialize app for testing:', err);
    process.exit(1);
  }

  // Start server on random available port
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api`;
  console.log(`📡 Test server running on ${baseUrl}\n`);

  // Generate tokens for testing
  const superAdminToken = jwt.sign(
    { userId: 1, role: 'super_admin', unit_db: 'vms_central' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const unitAdminToken = jwt.sign(
    { userId: 1, role: 'unit_admin', unit_db: 'vms_unit_u1' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const employeeToken = jwt.sign(
    { userId: 2, role: 'employee', unit_db: 'vms_unit_u1' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const securityToken = jwt.sign(
    { userId: 3, role: 'security', unit_db: 'vms_unit_u1' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const visitorToken = jwt.sign(
    {
      purpose: 'PUBLIC_VISITOR',
      visitor_name: 'Rahul Verma',
      visitor_phone: '9876543210',
      visitor_email: 'visitor@example.com',
      phone_verified: true,
      email_verified: true,
      aadhaar_verified: true
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const results = [];

  async function testEndpoint(testName, moduleName, method, endpoint, token, body, headers = {}, expectedStatus = [200, 201]) {
    const fullUrl = `${baseUrl}${endpoint}`;
    const reqHeaders = { 'Content-Type': 'application/json', ...headers };
    if (token) reqHeaders['Authorization'] = `Bearer ${token}`;

    const opts = {
      method,
      headers: reqHeaders,
    };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      opts.body = JSON.stringify(body);
    }

    const start = Date.now();
    try {
      const res = await fetch(fullUrl, opts);
      const duration = Date.now() - start;
      let data = null;
      const text = await res.text();
      try { data = JSON.parse(text); } catch (_) { data = text; }

      const isExpected = Array.isArray(expectedStatus)
        ? expectedStatus.includes(res.status)
        : res.status === expectedStatus;

      const record = {
        module: moduleName,
        test: testName,
        method,
        endpoint,
        status: res.status,
        duration: `${duration}ms`,
        passed: isExpected,
        message: data?.message || (typeof data === 'string' ? data.slice(0, 100) : 'OK'),
        data: data?.data || null
      };

      results.push(record);

      const symbol = isExpected ? '✅' : '❌';
      console.log(`[${symbol}] ${method.padEnd(6)} ${endpoint.padEnd(45)} | Status: ${res.status} | ${record.message}`);
      return record;
    } catch (err) {
      const record = {
        module: moduleName,
        test: testName,
        method,
        endpoint,
        status: 'FETCH_ERR',
        duration: `${Date.now() - start}ms`,
        passed: false,
        message: err.message,
        data: null
      };
      results.push(record);
      console.log(`[❌] ${method.padEnd(6)} ${endpoint.padEnd(45)} | ERR: ${err.message}`);
      return record;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1. HEALTH & SETUP
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- 1. Health & Setup ---');
  await testEndpoint('Health Check', 'Health', 'GET', '/health', null, null, {}, [200]);
  await testEndpoint('Setup Status', 'Setup', 'GET', '/setup/status', null, null, {}, [200]);

  // ───────────────────────────────────────────────────────────────────────────
  // 2. AUTHENTICATION & PROFILE
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- 2. Authentication & Profile ---');
  await testEndpoint('Get Profile (SuperAdmin)', 'Auth', 'GET', '/auth/me', superAdminToken, null, {}, [200]);
  await testEndpoint('Get Profile (UnitAdmin)', 'Auth', 'GET', '/auth/me', unitAdminToken, null, {}, [200]);
  await testEndpoint('Get Profile (Employee)', 'Auth', 'GET', '/auth/me', employeeToken, null, {}, [200]);
  await testEndpoint('Get Profile (Security)', 'Auth', 'GET', '/auth/me', securityToken, null, {}, [200]);
  await testEndpoint('Refresh Token', 'Auth', 'POST', '/auth/refresh', unitAdminToken, null, {}, [200]);
  await testEndpoint('Invalid Credentials Login', 'Auth', 'POST', '/auth/login', null, {
    email: 'nonexistent@test.com',
    password: 'WrongPassword@123',
    unit_code: 'U1'
  }, {}, [401, 404]);

  // ───────────────────────────────────────────────────────────────────────────
  // 3. PUBLIC AUTH & VISITOR FLOW
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- 3. Public Visitor Auth & Verification ---');
  await testEndpoint('Send Public Email OTP', 'PublicAuth', 'POST', '/public-auth/send-email-otp', null, {
    email: 'testvisitor@example.com'
  }, {}, [200, 500]); // 500 if SMTP not connected in dev
  await testEndpoint('Public Phone Lookup', 'VisitRequests', 'GET', '/visit-requests/lookup-visitor?phone=9876543210&unit_code=U1', null, null, {}, [200, 404]);

  // ───────────────────────────────────────────────────────────────────────────
  // 4. UNITS MANAGEMENT
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- 4. Units Management ---');
  await testEndpoint('List Public Units (No Auth)', 'Units', 'GET', '/units/public', null, null, {}, [200]);
  await testEndpoint('Get Unit by Code (No Auth)', 'Units', 'GET', '/units/by-code/U1', null, null, {}, [200]);
  await testEndpoint('List All Units (SuperAdmin)', 'Units', 'GET', '/units?page=1&limit=10', superAdminToken, null, {}, [200]);
  await testEndpoint('Get Unit by ID (SuperAdmin)', 'Units', 'GET', '/units/1', superAdminToken, null, {}, [200]);
  await testEndpoint('Unit Access Forbidden for Employee', 'Units', 'GET', '/units', employeeToken, null, {}, [403]);

  // ───────────────────────────────────────────────────────────────────────────
  // 5. USERS & CENTRAL USERS
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- 5. Users & Central Users ---');
  await testEndpoint('List Central Users (SuperAdmin)', 'CentralUsers', 'GET', '/central-users', superAdminToken, null, {}, [200]);
  await testEndpoint('List Central Users Forbidden for UnitAdmin', 'CentralUsers', 'GET', '/central-users', unitAdminToken, null, {}, [403]);
  await testEndpoint('List Unit Users (UnitAdmin)', 'Users', 'GET', '/users?page=1&limit=10', unitAdminToken, null, {}, [200]);
  await testEndpoint('List Hosts (Public / Employee)', 'Users', 'GET', '/users/hosts?unit_code=U1', null, null, {}, [200]);

  // ───────────────────────────────────────────────────────────────────────────
  // 6. DEPARTMENTS & DESIGNATIONS
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- 6. Departments & Designations ---');
  await testEndpoint('List Public Departments (No Auth)', 'Departments', 'GET', '/departments/public?unit_code=U1', null, null, {}, [200]);
  await testEndpoint('List Departments (UnitAdmin)', 'Departments', 'GET', '/departments', unitAdminToken, null, {}, [200]);
  await testEndpoint('List Designations (Employee)', 'Designations', 'GET', '/designations?department_id=1', employeeToken, null, {}, [200]);

  // ───────────────────────────────────────────────────────────────────────────
  // 7. VISITORS DIRECTORY & BLACKLIST
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- 7. Visitors & Blacklist ---');
  await testEndpoint('List Visitors Directory', 'Visitors', 'GET', '/visitors?page=1&limit=10', unitAdminToken, null, {}, [200]);
  await testEndpoint('Check Blacklist Status', 'Visitors', 'GET', '/visitors/blacklist-check?phone=9876543210&unit_code=U1', null, null, {}, [200]);
  await testEndpoint('Phone Lookup', 'Visitors', 'GET', '/visitors/lookup?phone=9876543210', securityToken, null, {}, [200, 404]);

  // ───────────────────────────────────────────────────────────────────────────
  // 8. VISIT REQUESTS & APPROVALS
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- 8. Visit Requests & Approvals ---');
  // Create a visit request as employee
  const createReqRes = await testEndpoint('Create Visit Request (Employee)', 'VisitRequests', 'POST', '/visit-requests', employeeToken, {
    visitor_name: 'Aditya Sen',
    visitor_phone: '9876543210',
    visitor_email: 'aditya@example.com',
    purpose: 'Quarterly review meeting',
    visit_category: 'EMPLOYEE_VISIT',
    visit_date: '2026-10-26',
    visit_start_time: '10:00:00',
    visit_end_time: '12:00:00',
    host_user_id: 2,
    department_id: 1,
    service_type: 'Review',
    work_order_ref: 'WO-101'
  }, {}, [200, 201]);

  let createdRequestId = createReqRes.data?.id || createReqRes.data?.requestId || 1;

  await testEndpoint('List All Visit Requests', 'VisitRequests', 'GET', '/visit-requests?page=1&limit=10', unitAdminToken, null, {}, [200]);
  await testEndpoint('Get My Requests (Employee)', 'VisitRequests', 'GET', '/visit-requests/my', employeeToken, null, {}, [200]);
  await testEndpoint('Get My Visitors (Employee)', 'VisitRequests', 'GET', '/visit-requests/my-visitors', employeeToken, null, {}, [200]);
  await testEndpoint('Get Approval Inbox', 'Approvals', 'GET', '/approvals/inbox?page=1&limit=10', employeeToken, null, {}, [200]);
  await testEndpoint('Get Blocked Visitors', 'VisitRequests', 'GET', '/visit-requests/my-blocked-visitors', employeeToken, null, {}, [200]);

  // ───────────────────────────────────────────────────────────────────────────
  // 9. GATE SECURITY & PASSES
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- 9. Gate Operations & Passes ---');
  await testEndpoint('Gate Dashboard Summary', 'Gate', 'GET', '/gate/dashboard', securityToken, null, {}, [200]);
  await testEndpoint('Active Visitors Inside', 'Gate', 'GET', '/gate/active', securityToken, null, {}, [200]);
  await testEndpoint('List Gate Passes', 'GatePasses', 'GET', '/passes?page=1&limit=10', securityToken, null, {}, [200]);

  // ───────────────────────────────────────────────────────────────────────────
  // 10. REPORTS & AUDIT LOGS
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- 10. Reports & Security Audit Trail ---');
  await testEndpoint('Global Summary (SuperAdmin)', 'Reports', 'GET', '/reports/global-summary', superAdminToken, null, {}, [200]);
  await testEndpoint('Global Recent Visits (SuperAdmin)', 'Reports', 'GET', '/reports/global-recent-visits', superAdminToken, null, {}, [200]);
  await testEndpoint('Global Audit Trail (SuperAdmin)', 'Reports', 'GET', '/reports/audit-logs/global?page=1&limit=20', superAdminToken, null, {}, [200]);
  await testEndpoint('Global Audit Forbidden for UnitAdmin', 'Reports', 'GET', '/reports/audit-logs/global', unitAdminToken, null, {}, [403]);
  await testEndpoint('Unit Audit Logs (UnitAdmin)', 'Reports', 'GET', '/reports/audit-logs?page=1&limit=20', unitAdminToken, null, {}, [200]);
  await testEndpoint('Visitor Summary Report', 'Reports', 'GET', '/reports/visitor-summary?range=month', unitAdminToken, null, {}, [200]);
  await testEndpoint('Daily Traffic Report', 'Reports', 'GET', '/reports/daily-traffic?days=30', unitAdminToken, null, {}, [200]);
  await testEndpoint('Top Hosts Report', 'Reports', 'GET', '/reports/top-hosts', unitAdminToken, null, {}, [200]);
  await testEndpoint('Active & Expected Report', 'Reports', 'GET', '/reports/active-expected', securityToken, null, {}, [200]);
  await testEndpoint('Rejected Visits Report', 'Reports', 'GET', '/reports/rejected', unitAdminToken, null, {}, [200]);
  await testEndpoint('Visit History Report', 'Reports', 'GET', '/reports/visit-history?page=1&limit=10', unitAdminToken, null, {}, [200]);
  await testEndpoint('Report Meta Units', 'Reports', 'GET', '/reports/meta/units', unitAdminToken, null, {}, [200]);
  await testEndpoint('Report Meta Departments', 'Reports', 'GET', '/reports/meta/departments', unitAdminToken, null, {}, [200]);
  await testEndpoint('Report Meta Employees', 'Reports', 'GET', '/reports/meta/employees', unitAdminToken, null, {}, [200]);

  // Close test server
  server.close();

  // Print summary statistics
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;

  console.log('\n================================================================');
  console.log(`   TEST SUITE EXECUTION COMPLETE: ${passed}/${total} PASSED`);
  if (failed > 0) {
    console.log(`   ⚠️ FAILED / UNEXPECTED: ${failed}`);
  } else {
    console.log(`   🎉 ALL ENDPOINTS WORKING AS EXPECTED`);
  }
  console.log('================================================================\n');

  // Write results JSON file for detailed inspection
  const reportPath = path.join(__dirname, '../../endpoint_test_results.json');
  const fs = require('fs');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    total,
    passed,
    failed,
    results
  }, null, 2), 'utf8');

  console.log(`Full report saved to: ${reportPath}`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal testing error:', err);
  process.exit(1);
});
