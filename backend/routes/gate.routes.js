// backend/routes/gate.routes.js
'use strict';

const express = require('express');
const router  = express.Router();

const { protect }   = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/rbac.middleware');
const { uploadVisitorPhoto } = require('../middlewares/upload.middleware');
const { sendError } = require('../utils/response.util');

const gateController = require('../controllers/gate.controller');

// GET /api/gate/dashboard
router.get(
  '/dashboard',
  protect,
  authorize('org_admin', 'dept_admin', 'security', 'receptionist', 'employee'),
  gateController.getDashboard
);

// GET /api/gate/active
router.get(
  '/active',
  protect,
  authorize('org_admin', 'dept_admin', 'security', 'receptionist'),
  gateController.getActiveVisitors
);

// POST /api/gate/checkin/:requestId
// Multer errors are caught inline before the controller runs.
router.post(
  '/checkin/:requestId',
  protect,
  authorize('org_admin', 'security', 'receptionist'),
  (req, res, next) => {
    uploadVisitorPhoto(req, res, (err) => {
      if (err) return sendError(res, err.message, 400);
      next();
    });
  },
  gateController.checkIn
);

// POST /api/gate/checkout
router.post(
  '/checkout',
  protect,
  authorize('org_admin', 'security', 'receptionist'),
  gateController.checkOut
);

// POST /api/gate/reject
router.post(
  '/reject',
  protect,
  authorize('org_admin', 'security'),
  gateController.rejectAtGate
);

module.exports = router;
