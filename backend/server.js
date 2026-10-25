// backend/server.js
'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
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

// Trust reverse proxy (needed for accurate client IP behind reverse proxy / load balancer in production)
app.set('trust proxy', 1);

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

// Global API rate limiting — base defense layer
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 100 : 10000,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// ── Standard middleware ───────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Static assets (uploaded photos & QR codes) ───────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Strict Rate Limiters for Authentication & OTP (P0 Security) ──────────────
// 1. Auth Login: Max 5 failed attempts per IP per 15 min (credential stuffing protection)
const authLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 5 : 20,
  message: {
    success: false,
    message: 'Too many failed login attempts from this IP. Please wait 15 minutes before trying again.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Only failed attempts (4xx/5xx) consume the quota
});
app.use('/api/auth/login', authLoginLimiter);

// 2. Login OTP Send: Max 3 successful OTP sends per IP per 10 min (prevents spamming user inboxes)
const loginOtpSendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 3 : 10,
  message: {
    success: false,
    message: 'Too many login OTP requests from this IP. Please wait 10 minutes before trying again.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true, // Only successful credential validations that trigger OTP count
});
app.use('/api/auth/login', loginOtpSendLimiter);

// 3. Public OTP Send: Max 3 OTP sends per IP per 10 min (SMS & Email flood protection)
const publicOtpSendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 3 : 15,
  message: {
    success: false,
    message: 'Too many OTP requests from this IP. Please wait 10 minutes before requesting another OTP.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/public-auth/send-phone-otp', publicOtpSendLimiter);
app.use('/api/public-auth/send-email-otp', publicOtpSendLimiter);
app.use('/api/otp/send', publicOtpSendLimiter);

// 4. OTP Verification: Max 10 attempts per IP per 10 min (brute-force defense against 6-digit codes)
const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 10 : 30,
  message: {
    success: false,
    message: 'Too many OTP verification attempts. Please wait 10 minutes before trying again.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/verify-login-otp', otpVerifyLimiter);
app.use('/api/public-auth/verify-email-otp', otpVerifyLimiter);
app.use('/api/public-auth/verify-firebase-phone', otpVerifyLimiter);
app.use('/api/otp/verify', otpVerifyLimiter);

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

async function start() {
  try {
    await autoMigrate();
    server.listen(PORT, () => {
      console.log(`[Server] VMS backend running on port ${PORT}`);
    });
  } catch (err) {
    console.error('[Server] Fatal error initializing database:', err.message);
    process.exit(1);
  }
}

start();
