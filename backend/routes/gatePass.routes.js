// backend/routes/gatePass.routes.js
'use strict';

const express = require('express');
const router  = express.Router();

const { protect }   = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/rbac.middleware');
const ctrl          = require('../controllers/gatePass.controller');

// POST /api/passes/generate/:requestId — manually generate/re-fetch a gate pass
router.post(
  '/generate/:requestId',
  protect,
  authorize('super_admin', 'unit_admin', 'security', 'receptionist'),
  ctrl.generatePass
);

// GET /api/passes/pass/:passNumber — retrieve and mark as printed
router.get(
  '/pass/:passNumber',
  protect,
  authorize('super_admin', 'unit_admin', 'security', 'receptionist', 'unit_auditor', 'global_auditor'),
  ctrl.getPass
);

// GET /api/passes — list all passes (with optional ?status=&date= filters)
router.get(
  '/',
  protect,
  authorize('super_admin', 'unit_admin', 'security', 'receptionist', 'unit_auditor', 'global_auditor'),
  ctrl.listPasses
);

// PUT /api/passes/:id/cancel
router.put(
  '/:id/cancel',
  protect,
  authorize('super_admin', 'unit_admin'),
  ctrl.cancelPass
);

module.exports = router;
