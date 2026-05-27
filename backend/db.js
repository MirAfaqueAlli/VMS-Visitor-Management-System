// backend/db.js
// Re-exports the centralPool from dbManager.
// Controllers being migrated to multi-DB should use req.db instead.
// This file keeps backward compatibility during the migration.
'use strict';

const { centralPool } = require('./services/dbManager');

module.exports = centralPool;
