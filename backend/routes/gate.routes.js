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
const { findSuperAdminProfile } = require('../services/adminProfile.service');
const { getPool } = require('../services/dbManager');

/**
 * A super admin is read-only inside units, except as the host of their own visitors:
 * with ?personal=1 they act as their unit employee profile (Profile → Unit membership),
 * so the employee rule applies — check in / out only visitors they host.
 */
const actAsUnitProfile = async (req, res, next) => {
  if (req.user?.role_type !== 'super_admin' || req.query.personal !== '1') return next();
  try {
    const profile = await findSuperAdminProfile(req.user.id);
    if (!profile) return sendError(res, 'Join a unit as an employee from your Profile page first.', 403);
    req.db         = getPool(profile.unit_db);
    req.unitDbName = profile.unit_db;
    req.user = {
      ...req.user,
      id:            profile.id,
      role_type:     'employee',
      unit_id:       profile.unit_id,
      department_id: profile.department_id,
      unit_db:       profile.unit_db,
    };
    return next();
  } catch (err) {
    console.error('[GateRoutes] actAsUnitProfile error:', err.message);
    return sendError(res, 'Could not load your unit profile.', 500);
  }
};

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

// GET /api/gate/upcoming — approved visits from today on (gate "Upcoming visits")
router.get(
  '/upcoming',
  protect,
  authorize('unit_admin', 'security', 'receptionist'),
  gateController.getUpcoming
);

// POST /api/gate/lookup — scanned QR / typed pass number → can this visitor check in now?
router.post(
  '/lookup',
  protect,
  actAsUnitProfile,
  authorize('unit_admin', 'security', 'receptionist', 'employee'),
  gateController.lookupPass
);

// POST /api/gate/checkin/:requestId
router.post(
  '/checkin/:requestId',
  protect,
  actAsUnitProfile,
  // Gate operations are unit staff only — super_admin is read-only inside units.
  // Employees may check in / out only visitors they host (enforced in the controller).
  authorize('unit_admin', 'security', 'receptionist', 'employee'),
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
  actAsUnitProfile,
  authorize('unit_admin', 'security', 'receptionist', 'employee'),
  validate(checkoutSchema),
  gateController.checkOut
);

// POST /api/gate/checkout/qr  — MUST be before /:visitLogId to avoid param clash
router.post(
  '/checkout/qr',
  protect,
  actAsUnitProfile,
  authorize('unit_admin', 'security', 'receptionist', 'employee'),
  validate(checkoutQRSchema),
  gateController.checkOutByQR
);

router.post(
  '/checkout/:visitLogId',
  protect,
  actAsUnitProfile,
  authorize('unit_admin', 'security', 'receptionist', 'employee'),
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
