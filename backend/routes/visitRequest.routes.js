// backend/routes/visitRequest.routes.js
'use strict';

const express = require('express');
const router = express.Router();
const visitRequestController = require('../controllers/visitRequest.controller');
const { protect } = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/rbac.middleware');
const { z } = require('zod');
const { sendError } = require('../utils/response.util');
const jwt = require('jsonwebtoken');
const db = require('../db');

const requestSchema = z.object({
  visit_category: z.enum(['EMP', 'VENDOR', 'PRIOR', 'SPOT']),
  host_user_id: z.number(),
  department_id: z.number().optional().nullable(),
  organization_id: z.number().optional().nullable(),
  purpose: z.string().min(10, 'Purpose must be at least 10 characters'),
  visit_date: z.string(),
  visit_start_time: z.string().optional().nullable(),
  visit_end_time: z.string().optional().nullable(),
  accompanying_count: z.number().optional().default(0),
  company_name: z.string().optional().nullable(),
  vendor_email: z.string().email('Invalid email').or(z.literal('')).optional().nullable().transform(v => v || null),
  contact_person: z.string().optional().nullable(),
  gst_number: z.string().optional().nullable(),
  work_order_ref: z.string().optional().nullable(),
  service_type: z.string().optional().nullable(),
  visitor_id: z.number().optional().nullable(),
  companions: z.array(z.object({
    full_name: z.string(),
    id_type: z.string().optional().nullable(),
    id_number: z.string().optional().nullable()
  })).optional().nullable()
});

const validateRequest = (req, res, next) => {
  try {
    req.body = requestSchema.parse(req.body);
    next();
  } catch (err) {
    return sendError(res, 'Validation error', 400, err.errors);
  }
};

const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const [rows] = await db.query(
      `SELECT u.*, u.role_type AS role_type FROM users u WHERE u.id = ?`,
      [decoded.userId]
    );
    if (rows.length > 0 && rows[0].is_active === 1) {
      req.user = rows[0];
    }
  } catch (err) {
    // silently fail and proceed as guest if token is invalid
  }
  next();
};

router.post('/', optionalAuth, validateRequest, visitRequestController.createRequest);
router.post('/public', visitRequestController.createPublicRequest);

router.get('/', protect, authorize('org_admin', 'dept_admin', 'security', 'receptionist', 'employee'), visitRequestController.listRequests);
// /my must come BEFORE /:id to avoid being captured as an id param
router.get('/my', protect, visitRequestController.getMyRequests);
router.get('/:id', protect, visitRequestController.getRequest);
router.put('/:id/cancel', protect, visitRequestController.cancelRequest);

module.exports = router;
