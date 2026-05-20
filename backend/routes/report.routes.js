// backend/routes/report.routes.js
'use strict';

const express   = require('express');
const router    = express.Router();
const ctrl      = require('../controllers/report.controller');
const { protect }   = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/rbac.middleware');

router.get('/visitor-summary', protect, authorize('org_admin', 'dept_admin'), ctrl.getVisitorSummary);
router.get('/by-status',       protect, authorize('org_admin', 'dept_admin'), ctrl.getByStatus);
router.get('/by-department',   protect, authorize('org_admin', 'dept_admin'), ctrl.getByDepartment);
router.get('/visitor-type',    protect, authorize('org_admin', 'dept_admin'), ctrl.getByVisitorType);

module.exports = router;
