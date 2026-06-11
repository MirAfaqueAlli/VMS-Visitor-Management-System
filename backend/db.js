// backend/db.js
//
// DEPRECATED — backward-compatibility shim only.
//
// New code should use `req.db` (injected by auth.middleware) or import
// `centralPool` / `getPool()` directly from './services/dbManager'.
//
// This file exists so that any legacy import of `require('./db')` still works.
'use strict';

const { centralPool } = require('./services/dbManager');

module.exports = centralPool;
