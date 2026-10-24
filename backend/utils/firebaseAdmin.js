// backend/utils/firebaseAdmin.js
'use strict';

/**
 * Firebase Admin SDK — modular API (firebase-admin v12+).
 *
 * firebase-admin v12 dropped the legacy namespace API (admin.apps, admin.auth()).
 * We now import each service from its own sub-package:
 *   - 'firebase-admin/app'  → initializeApp, getApps, cert
 *   - 'firebase-admin/auth' → getAuth
 *
 * The service account JSON is loaded from backend/config/firebase-service-account.json.
 * That file is git-ignored and must NEVER be committed.
 */

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth }                       = require('firebase-admin/auth');
const path                              = require('path');

const serviceAccount = require(path.join(__dirname, '../config/firebase-service-account.json'));

// Only initialise once — safe across hot-reloads and multiple requires
if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}

// Export getAuth so callers can do:  const { auth } = require('./firebaseAdmin');
//                                    await auth.verifyIdToken(idToken)
const auth = getAuth();

module.exports = { auth };
