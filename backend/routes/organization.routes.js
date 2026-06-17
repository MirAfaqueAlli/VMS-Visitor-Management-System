// backend/routes/organization.routes.js
'use strict';

/**
 * In the multi-unit architecture, the concept of "organizations" has been
 * replaced by "units" (managed via /api/units in unit.routes.js).
 *
 * This file is kept for backward compatibility. It now:
 *   - Redirects setup-status to check if any unit exists (via centralPool)
 *   - Redirects the list endpoint to return active units
 *   - Removes the old single-org endpoints (no longer relevant)
 */

const express = require('express');
const router  = express.Router();
const { centralPool } = require('../services/dbManager');
const { sendSuccess, sendError } = require('../utils/response.util');
const { protect }   = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/rbac.middleware');

// ── Public: check if setup is complete (if any unit exists) ──────────────────
router.get('/setup-status', async (req, res) => {
  try {
    const [rows] = await centralPool.query('SELECT COUNT(*) AS count FROM units WHERE is_active = 1');
    const isSetup = rows[0].count > 0;
    return sendSuccess(res, { isSetup }, 'Setup status fetched successfully.');
  } catch (err) {
    console.error('[OrgRoute] setup-status error:', err.message);
    return sendError(res, 'Failed to fetch setup status.', 500);
  }
});

// ── Public: list active units (replaces listing organizations) ────────────────
router.get('/', async (req, res) => {
  try {
    const [rows] = await centralPool.query(
      `SELECT id, name, code, city, db_status FROM units WHERE is_active = 1 ORDER BY name ASC`
    );
    return sendSuccess(res, rows, 'Units fetched successfully.');
  } catch (err) {
    console.error('[OrgRoute] list error:', err.message);
    return sendError(res, 'Failed to fetch units.', 500);
  }
});

// ── Protected: get single unit details ───────────────────────────────────────
router.get('/:id', protect, async (req, res) => {
  try {
    const [rows] = await centralPool.query(
      `SELECT id, name, code, city, state, phone, email, is_active, db_status, created_at
       FROM units WHERE id = ?`,
      [req.params.id]
    );
    if (!rows.length) return sendError(res, 'Unit not found.', 404);
    return sendSuccess(res, rows[0], 'Unit fetched successfully.');
  } catch (err) {
    console.error('[OrgRoute] get error:', err.message);
    return sendError(res, 'Failed to fetch unit.', 500);
  }
});

module.exports = router;
