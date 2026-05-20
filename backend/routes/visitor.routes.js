// backend/routes/visitor.routes.js
'use strict';

const express = require('express');
const router = express.Router();
const visitorController = require('../controllers/visitor.controller');
const { protect } = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/rbac.middleware');
const { z } = require('zod');
const { sendError } = require('../utils/response.util');
const { uploadVisitorPhoto } = require('../middlewares/upload.middleware');

const visitorSchema = z.object({
  full_name: z.string().min(2, 'Name must be at least 2 characters'),
  phone: z.string().regex(/^\d{10}$/, 'Phone must be 10 digits'),
  email: z.string().email('Invalid email').or(z.literal('')).optional().nullable().transform(v => v || null),
  address: z.string().optional().nullable().transform(v => v || null),
  id_type: z.string().optional().nullable().transform(v => v || null),
  id_number: z.string().optional().nullable().transform(v => v || null),
  visitor_type: z.enum(['individual', 'business']),
  organization_id: z.preprocess((val) => (val === '' || val === undefined ? null : Number(val)), z.number().optional().nullable()),
  visit_category: z.string().optional().nullable().transform(v => v || null),
  company_name: z.string().optional().nullable().transform(v => v || null),
  contact_person_name: z.string().optional().nullable().transform(v => v || null),
  gst_number: z.string().optional().nullable().transform(v => v || null),
  service_type: z.string().optional().nullable().transform(v => v || null),
  access_zone: z.string().optional().nullable().transform(v => v || null)
});

const validateVisitor = (req, res, next) => {
  try {
    req.body = visitorSchema.parse(req.body);
    next();
  } catch (err) {
    return sendError(res, 'Validation error', 400, err.errors);
  }
};

router.post('/', uploadVisitorPhoto, validateVisitor, visitorController.createVisitor);
router.get('/blacklist-check', visitorController.checkBlacklist);
router.get('/', protect, authorize('org_admin', 'dept_admin', 'security', 'receptionist', 'employee'), visitorController.listVisitors);
router.get('/:id', protect, visitorController.getVisitor);

module.exports = router;
