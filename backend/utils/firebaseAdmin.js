// backend/utils/firebaseAdmin.js
'use strict';

/**
 * Firebase Admin SDK initialisation — env-var based (production-safe).
 *
 * Instead of loading a JSON key file from disk (which can never be committed
 * to git), credentials are read from environment variables:
 *
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY   ← paste the full private key string, newlines as \n
 *
 * On your server / CI, set these in the environment or .env file.
 * The values come from the Firebase service-account JSON your manager has.
 *
 * How to extract the values from the JSON file:
 *   "project_id"    → FIREBASE_PROJECT_ID
 *   "client_email"  → FIREBASE_CLIENT_EMAIL
 *   "private_key"   → FIREBASE_PRIVATE_KEY  (the whole -----BEGIN ... END----- block)
 */

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth }                       = require('firebase-admin/auth');

const projectId   = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
// Private key is stored with literal \n in env — convert back to real newlines
const privateKey  = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

if (!projectId || !clientEmail || !privateKey) {
  throw new Error(
    '[FirebaseAdmin] Missing required env vars: FIREBASE_PROJECT_ID, ' +
    'FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY. ' +
    'Set these in your .env file or server environment.'
  );
}

// Only initialise once — safe across hot-reloads and multiple requires
if (!getApps().length) {
  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

const auth = getAuth();

module.exports = { auth };
