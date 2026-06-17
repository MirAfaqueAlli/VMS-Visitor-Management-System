// backend/routes/unit.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/unit.controller');
const { protect }   = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/rbac.middleware');

// ── Public (no auth) ──────────────────────────────────────────────────────────
// Must be declared BEFORE the protect middleware routes to avoid auth checks.
router.get('/public',         ctrl.getPublicUnits);
router.get('/by-code/:code',  ctrl.getUnitByCode);   // unit-scoped login URL

// All unit routes require super_admin or global_auditor (read-only for auditor enforced in controller)
router.get('/',    protect, authorize('super_admin', 'global_auditor'), ctrl.listUnits);
router.get('/:id', protect, authorize('super_admin', 'global_auditor'), ctrl.getUnitById);
router.post('/',   protect, authorize('super_admin'),                   ctrl.createUnit);
router.put('/:id', protect, authorize('super_admin'),                   ctrl.updateUnit);
router.delete('/:id', protect, authorize('super_admin'),                ctrl.deactivateUnit);

module.exports = router;
