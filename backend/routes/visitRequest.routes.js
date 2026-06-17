// backend/routes/visitRequest.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/visitRequest.controller');
const { protect, optionalProtect } = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/rbac.middleware');
const { z }         = require('zod');
const { sendError } = require('../utils/response.util');

// ── Helpers ───────────────────────────────────────────────────────────────────
// Coerce empty string / null / undefined to null; otherwise parse as number.
// This prevents Zod from rejecting "" when a numeric ID field is left blank.
const maybeNumber = z.preprocess(
  (v) => (v === '' || v === undefined || v === null) ? null : Number(v),
  z.number().nullable()
);

// ── Validation schema ─────────────────────────────────────────────────────────

const requestSchema = z.object({
  visit_category:   z.enum(['EMPLOYEE_VISIT', 'VENDOR', 'SPOT', 'PERSONAL_VISIT']),
  request_source:   z.enum(['SELF', 'HOST', 'RECEPTION']).optional().nullable(),
  host_user_id:     maybeNumber.optional(),
  department_id:    maybeNumber.optional(),
  unit_id:          maybeNumber.optional(),
  target_unit_id:   maybeNumber.optional(), // EMPLOYEE_VISIT cross-unit: route request to host's unit DB
  visitor_id:       maybeNumber.optional(),
  purpose:          z.string().min(3, 'Purpose must be at least 3 characters'),
  visit_date:       z.string().min(1, 'Visit date is required'),
  visit_start_time: z.string().optional().nullable(),
  visit_end_time:   z.string().optional().nullable(),
  accompanying_count: z.preprocess((v) => (v === '' || v === undefined || v === null) ? 0 : Number(v), z.number().default(0)),
  // Visitor details (inline or by ID)
  visitor_phone:  z.string().optional().nullable(),
  visitor_name:   z.string().optional().nullable(),
  visitor_email:  z.string().email('Invalid email').or(z.literal('')).optional().nullable().transform(v => v || null),
  // Vendor-specific
  company_name:   z.string().optional().nullable(),
  vendor_email:   z.string().email('Invalid email').or(z.literal('')).optional().nullable().transform(v => v || null),
  contact_person: z.string().optional().nullable(),
  gst_number:     z.string().optional().nullable(),
  work_order_ref: z.string().optional().nullable(),
  service_type:   z.string().optional().nullable(),
  // Conflict override
  force_create:   z.boolean().optional().default(false),
  // Companions
  companions: z.array(z.object({
    full_name: z.string(),
    id_type:   z.string().optional().nullable(),
    id_number: z.string().optional().nullable(),
  })).optional().default([]),
});

const validateRequest = (req, res, next) => {
  try {
    req.body = requestSchema.parse(req.body);
    next();
  } catch (err) {
    const issues = err.issues || err.errors || [];
    console.error('[ZodValidationError] Visit request validation failed:', JSON.stringify(issues));
    return sendError(res, 'Validation error', 400, issues);
  }
};

// ── Routes ────────────────────────────────────────────────────────────────────

// Public phone lookup — uses req.db if authenticated, or requires unit_code if not
router.get('/lookup-visitor', optionalProtect, ctrl.lookupVisitorByPhone);

// Public visitor self-registration — requires unit_code in body
router.post('/public', ctrl.createPublicRequest);

// Authenticated: employee's personal visitor history (own visits only)
// /my-visitors must come BEFORE /:id to avoid being captured as a param
router.get('/my-visitors', protect, ctrl.getMyVisitors);

// My requests — own visits (as host or requester)
// /my must come BEFORE /:id
router.get('/my', protect, ctrl.getMyRequests);

// Create authenticated visit request
router.post(
  '/',
  protect,
  authorize('super_admin', 'unit_admin', 'employee', 'security', 'receptionist'),
  validateRequest,
  ctrl.createRequest
);

// List all requests — admin/security roles + auditors
router.get(
  '/',
  protect,
  authorize('super_admin', 'unit_admin', 'security', 'receptionist', 'employee', 'unit_auditor', 'global_auditor'),
  ctrl.listRequests
);

// Get single request
router.get('/:id', protect, ctrl.getRequest);

// Cancel request
router.put('/:id/cancel', protect, ctrl.cancelRequest);

// ── Host-level visitor blocking (host blocks by phone from a visit request) ──
// my-blocked-visitors must come BEFORE /:id to avoid param collision
router.get(
  '/my-blocked-visitors',
  protect,
  authorize('super_admin', 'unit_admin', 'employee'),
  ctrl.getHostBlacklist
);

// Unblock a visitor from the host's personal blacklist
router.delete(
  '/blocked-visitors/:blockId',
  protect,
  authorize('super_admin', 'unit_admin', 'employee'),
  ctrl.unblockVisitor
);

// Block visitor by phone from a specific visit request (host or admin)
router.post(
  '/:id/blacklist-visitor',
  protect,
  authorize('super_admin', 'unit_admin', 'employee'),
  ctrl.blacklistVisitorFromRequest
);

module.exports = router;
