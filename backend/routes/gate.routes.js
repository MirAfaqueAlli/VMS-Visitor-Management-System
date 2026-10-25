// backend/routes/gate.routes.js
'use strict';

const express = require('express');
const router  = express.Router();

const { protect }   = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/rbac.middleware');
const { uploadVisitorPhoto } = require('../middlewares/upload.middleware');
const { sendError } = require('../utils/response.util');
const { validate }  = require('../middlewares/validate.middleware');
const {
  checkinSchema,
  checkoutSchema,
  checkoutQRSchema,
  rejectAtGateSchema,
} = require('../validators/schemas');

const gateController = require('../controllers/gate.controller');

// GET /api/gate/dashboard
router.get(
  '/dashboard',
  protect,
  authorize('super_admin', 'unit_admin', 'security', 'receptionist', 'employee', 'unit_auditor', 'global_auditor'),
  gateController.getDashboard
);

// GET /api/gate/active
router.get(
  '/active',
  protect,
  authorize('super_admin', 'unit_admin', 'security', 'receptionist', 'unit_auditor', 'global_auditor'),
  gateController.getActiveVisitors
);

// POST /api/gate/checkin/:requestId
router.post(
  '/checkin/:requestId',
  protect,
  // Gate operations are unit staff only — super_admin is read-only inside units
  authorize('unit_admin', 'security', 'receptionist'),
  (req, res, next) => {
    uploadVisitorPhoto(req, res, (err) => {
      if (err) return sendError(res, err.message, 400);
      next();
    });
  },
  validate(checkinSchema),
  gateController.checkIn
);

// POST /api/gate/checkout
router.post(
  '/checkout',
  protect,
  authorize('unit_admin', 'security', 'receptionist'),
  validate(checkoutSchema),
  gateController.checkOut
);

// POST /api/gate/checkout/qr  — MUST be before /:visitLogId to avoid param clash
router.post(
  '/checkout/qr',
  protect,
  authorize('unit_admin', 'security', 'receptionist'),
  validate(checkoutQRSchema),
  gateController.checkOutByQR
);

router.post(
  '/checkout/:visitLogId',
  protect,
  authorize('unit_admin', 'security', 'receptionist'),
  validate(checkoutSchema),
  gateController.checkOut
);

// POST /api/gate/reject
router.post(
  '/reject',
  protect,
  authorize('unit_admin', 'security'),
  validate(rejectAtGateSchema),
  gateController.rejectAtGate
);

module.exports = router;
