// backend/routes/visitor.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/visitor.controller');
const { protect, optionalProtect } = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/rbac.middleware');
const { z }         = require('zod');
const { sendError } = require('../utils/response.util');
const { uploadVisitorPhoto } = require('../middlewares/upload.middleware');

const visitorSchema = z.object({
  full_name: z.string().min(2, 'Name must be at least 2 characters'),
  phone:     z.string().min(10, 'Phone must be at least 10 digits'),
  email:     z.string().email('Invalid email').or(z.literal('')).optional().nullable().transform(v => v || null),
  address:   z.string().optional().nullable().transform(v => v || null),
  id_type:   z.string().optional().nullable().transform(v => v || null),
  id_number: z.string().optional().nullable().transform(v => v || null),
});

const validateVisitor = (req, res, next) => {
  try {
    req.body = visitorSchema.parse(req.body);
    next();
  } catch (err) {
    return sendError(res, 'Validation error', 400, err.errors);
  }
};

// Blacklist check — optionalProtect so it can be called by gate staff or public kiosk
router.get('/blacklist-check', optionalProtect, ctrl.checkBlacklist);

// List visitors — admin, security, receptionist, employee + auditors
router.get(
  '/',
  protect,
  authorize('super_admin', 'unit_admin', 'security', 'receptionist', 'employee', 'unit_auditor', 'global_auditor'),
  ctrl.listVisitors
);

// Manually register a visitor (gate/reception/employee)
router.post(
  '/',
  protect,
  authorize('super_admin', 'unit_admin', 'security', 'receptionist', 'employee'),
  uploadVisitorPhoto,
  validateVisitor,
  ctrl.createVisitor
);

// Phone lookup — must be BEFORE /:id route
router.get('/lookup', protect, ctrl.lookupVisitorByPhone);

// Get single visitor
router.get('/:id', protect, ctrl.getVisitor);

// Blacklist management — admin only
router.post(
  '/:id/blacklist',
  protect,
  authorize('super_admin', 'unit_admin'),
  ctrl.addToBlacklist
);

router.put(
  '/:id/blacklist/lift',
  protect,
  authorize('super_admin', 'unit_admin'),
  ctrl.liftBlacklist
);

module.exports = router;
