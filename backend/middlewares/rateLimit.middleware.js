// backend/middlewares/rateLimit.middleware.js
'use strict';

const rateLimit = require('express-rate-limit');

// ── Per-IP brute-force limits for sign-in and verification endpoints ──────────
// Relaxed outside production, like the global limiter in server.js.
const isProd = process.env.NODE_ENV === 'production';

/**
 * @param {number}  limit            requests per 15 minutes per IP (×10 outside production)
 * @param {string}  message          error message once the limit is hit
 * @param {boolean} [countSuccessful] count every request, not only failed ones
 */
const authLimiter = (limit, message, countSuccessful = false) => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isProd ? limit : limit * 10,
  skipSuccessfulRequests: !countSuccessful,   // usually only failed attempts count
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message },
});

module.exports = { authLimiter };
