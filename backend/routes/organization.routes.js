// backend/routes/organization.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { sendSuccess, sendError } = require('../utils/response.util');
const { protect }   = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/rbac.middleware');

// ── Public: check if setup is complete (if any org exists) ───────────────────
router.get('/setup-status', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT COUNT(*) as count FROM organizations');
    const isSetup = rows[0].count > 0;
    return sendSuccess(res, { isSetup }, 'Setup status fetched successfully.');
  } catch (err) {
    console.error('[OrgRoute] setup-status error:', err.message);
    return sendError(res, 'Failed to fetch setup status.', 500);
  }
});

// ── Public: list active organizations (for PublicRequest form) ───────────────
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, code, city, type FROM organizations WHERE is_active = TRUE ORDER BY name ASC`
    );
    return sendSuccess(res, rows, 'Organizations fetched successfully.');
  } catch (err) {
    console.error('[OrgRoute] list error:', err.message);
    return sendError(res, 'Failed to fetch organizations.', 500);
  }
});

// ── Protected: get single org (authenticated users) ──────────────────────────
router.get('/:id', protect, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, code, type, city, state, phone, email, is_active, created_at FROM organizations WHERE id = ?`,
      [req.params.id]
    );
    if (!rows.length) return sendError(res, 'Organization not found.', 404);
    return sendSuccess(res, rows[0], 'Organization fetched successfully.');
  } catch (err) {
    console.error('[OrgRoute] get error:', err.message);
    return sendError(res, 'Failed to fetch organization.', 500);
  }
});

// ── org_admin only: update org details ───────────────────────────────────────
router.put('/:id', protect, authorize('org_admin'), async (req, res) => {
  try {
    const { name, type, city, state, phone, email, address } = req.body;
    await pool.query(
      `UPDATE organizations SET name=?, type=?, city=?, state=?, phone=?, email=?, address=?, updated_at=NOW() WHERE id=?`,
      [name, type || null, city || null, state || null, phone || null, email || null, address || null, req.params.id]
    );
    return sendSuccess(res, null, 'Organization updated successfully.');
  } catch (err) {
    console.error('[OrgRoute] update error:', err.message);
    return sendError(res, 'Failed to update organization.', 500);
  }
});

module.exports = router;
