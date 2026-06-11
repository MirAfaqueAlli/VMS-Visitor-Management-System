// backend/server.js
'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
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
const archiveRoutes = require('./routes/archive.routes');
const publicAuthRoutes = require('./routes/publicAuth.routes');

const app = express();

// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: [
    process.env.CLIENT_URL,
  ].filter(Boolean),
  credentials: true,
}));

// Rate limiting — strict in production, relaxed for local dev
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 100 : 10000,
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// ── Standard middleware ───────────────────────────────────────────────────────
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Static assets (uploaded photos & QR codes) ───────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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
app.use('/api/archive', archiveRoutes);
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
  res.status(500).json({
    status: 'ERROR',
    message: 'Internal Server Error',
    error: err.message,
  });
});

// ── Start server with Socket.IO ───────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

initSocket(server);

server.listen(PORT, () => {
  console.log(`[Server] VMS backend running on port ${PORT}`);
});
