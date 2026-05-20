// backend/routes/gatePass.routes.js
'use strict';

const express = require('express');
const router  = express.Router();

const { protect }   = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/rbac.middleware');

const gatePassController = require('../controllers/gatePass.controller');

// POST /api/passes/generate/:requestId
router.post(
  '/generate/:requestId',
  protect,
  authorize('org_admin', 'dept_admin', 'security', 'receptionist'),
  gatePassController.generatePass
);

// GET /api/passes/pass/:passNumber
router.get(
  '/pass/:passNumber',
  protect,
  authorize('org_admin', 'dept_admin', 'security', 'receptionist'),
  gatePassController.getPass
);

// GET /api/passes/
router.get(
  '/',
  protect,
  authorize('org_admin', 'dept_admin', 'security'),
  gatePassController.listPasses
);

module.exports = router;
