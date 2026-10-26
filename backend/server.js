// backend/server.js
'use strict';

// OHPC operates in IST. Pin the process timezone before anything uses Date, so
// "today" (check-in date check, dashboards, pass numbers, email dates) is the IST
// date even on a UTC cloud server. MySQL sessions are pinned too (services/dbManager.js).
process.env.TZ = 'Asia/Kolkata';

const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const { initSocket } = require('./socket/socketManager');

// ── Route imports ────────────────────────────────────────────────────────────
const authRoutes = require('./routes/auth.routes');
const setupRoutes = require('./routes/setup.routes');
const visitorRoutes = require('./routes/visitor.routes');
const visitRequestRoutes = require('./routes/visitRequest.routes');
const approvalRoutes = require('./routes/approval.routes');
const otpRoutes = require('./routes/otp.routes');
const gateRoutes = require('./routes/gate.routes');
const gatePassRoutes = require('./routes/gatePass.routes');
const userRoutes = require('./routes/user.routes');
const reportRoutes = require('./routes/report.routes');
const departmentRoutes = require('./routes/department.routes');
const organizationRoutes = require('./routes/organization.routes');
const unitRoutes = require('./routes/unit.routes');
const designationRoutes = require('./routes/designation.routes');
const centralUserRoutes = require('./routes/centralUser.routes');
const publicAuthRoutes = require('./routes/publicAuth.routes');

const app = express();
app.set('trust proxy', 'loopback');
// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: [
    process.env.CLIENT_URL,
    process.env.NODE_ENV !== 'production' && 'http://localhost:5173',
    process.env.NODE_ENV !== 'production' && 'http://localhost:5174',
    process.env.NODE_ENV !== 'production' && 'http://localhost:3000',
  ].filter(Boolean),
  credentials: true,
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Signed-in staff are counted per user, everyone else per IP: a whole office
// usually shares one public IP, so a per-IP limit would cap every user there
// together. Sign-in / OTP / password-reset routes add stricter per-IP limits of
// their own (middlewares/rateLimit.middleware.js). Relaxed for local dev.
const isProd = process.env.NODE_ENV === 'production';
const API_LIMIT_USER   = parseInt(process.env.API_RATE_LIMIT, 10)        || 3000; // per signed-in user, per 15 min
const API_LIMIT_PUBLIC = parseInt(process.env.API_RATE_LIMIT_PUBLIC, 10) || 600;  // per IP when not signed in

/**
 * "user:<db>:<id>" for a request carrying a valid session token, else null.
 * Only picks the rate-limit bucket — `protect` still does the real auth check.
 */
const sessionKey = (req) => {
  if (req.rateLimitUser === undefined) {
    req.rateLimitUser = null;
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Bearer' && token) {
      try {
        const { userId, unit_db } = jwt.verify(token, process.env.JWT_SECRET);
        if (userId) req.rateLimitUser = `user:${unit_db}:${userId}`;
      } catch { /* expired or invalid: counted by IP */ }
    }
  }
  return req.rateLimitUser;
};

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: (req) => (!isProd ? 10000 : sessionKey(req) ? API_LIMIT_USER : API_LIMIT_PUBLIC),
  keyGenerator: (req) => sessionKey(req) || ipKeyGenerator(req.ip),
  skip: (req) => req.path === '/health',   // uptime monitors
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please wait a few minutes and try again.' },
});
app.use('/api/', apiLimiter);

// ── Standard middleware ───────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Uploaded photos & QR codes live in S3 (utils/s3.util.js). The old public
// /uploads static route was removed — it served ID proofs without any auth.

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/setup', setupRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/visitors', visitorRoutes);
app.use('/api/visit-requests', visitRequestRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/gate', gateRoutes);
app.use('/api/passes', gatePassRoutes);
app.use('/api/users', userRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/units', unitRoutes);
app.use('/api/designations', designationRoutes);
app.use('/api/central-users', centralUserRoutes);
app.use('/api/public-auth', publicAuthRoutes);

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const { centralPool } = require('./services/dbManager');
    await centralPool.query('SELECT 1');
    res.status(200).json({
      status: 'OK',
      message: 'VMS backend running — central DB connected',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Health check failed:', err.message);
    res.status(500).json({ status: 'ERROR', message: 'Central DB connection failed' });
  }
});

// ── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err.stack);
  res.status(err.status || 500).json({
    status:  'ERROR',
    message: process.env.NODE_ENV === 'production'
      ? 'Internal Server Error'
      : (err.message || 'Internal Server Error'),
  });
});

// ── Bootstrap server with database auto-migration & Socket.IO ─────────────────
const PORT = process.env.PORT || 5001;
const server = http.createServer(app);

initSocket(server);

const { autoMigrate } = require('./services/databaseInit.service');
const { startReminderScheduler } = require('./services/reminder.service');

async function start() {
  try {
    await autoMigrate();
    server.listen(PORT, () => {
      console.log(`[Server] VMS backend running on port ${PORT}`);
      startReminderScheduler(); // daily visit/approval reminders (tender 1.3)
    });
  } catch (err) {
    console.error('[Server] Fatal error initializing database:', err.message);
    process.exit(1);
  }
}

start();
