// backend/routes/report.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/report.controller');
const { protect }   = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/rbac.middleware');

const adminOrAuditor = ['super_admin', 'unit_admin', 'unit_auditor', 'global_auditor'];

router.get('/visitor-summary', protect, authorize('super_admin', 'unit_admin', 'unit_auditor', 'global_auditor'), ctrl.getVisitorSummary);
router.get('/by-status',       protect, authorize('super_admin', 'unit_admin', 'unit_auditor', 'global_auditor'), ctrl.getByStatus);
router.get('/by-department',   protect, authorize('super_admin', 'unit_admin', 'unit_auditor', 'global_auditor'), ctrl.getByDepartment);
router.get('/visitor-type',    protect, authorize('super_admin', 'unit_admin', 'unit_auditor', 'global_auditor'), ctrl.getByVisitorType);
router.get('/daily-traffic',   protect, authorize('super_admin', 'unit_admin', 'unit_auditor', 'global_auditor'), ctrl.getDailyTraffic);
router.get('/top-hosts',       protect, authorize('super_admin', 'unit_admin', 'unit_auditor', 'global_auditor'), ctrl.getTopHosts);

// ── Global summary — super_admin + global_auditor ───────────────────────────
router.get(
  '/global-summary',
  protect,
  authorize('super_admin', 'global_auditor'),
  ctrl.getGlobalSummary
);

// ── Global recent visits — super_admin + global_auditor ─────────────────────
router.get(
  '/global-recent-visits',
  protect,
  authorize('super_admin', 'global_auditor'),
  ctrl.getGlobalRecentVisits
);

// ── Audit logs — NOTE: /global MUST be registered before / to avoid conflict ─
router.get(
  '/audit-logs/global',
  protect,
  (req, res, next) => {
    const role = req.user?.role_type;
    if (['super_admin', 'global_auditor'].includes(role)) return next();
    return res.status(403).json({ success: false, message: 'Access denied.' });
  },
  ctrl.getGlobalAuditLogs
);

router.get(
  '/audit-logs',
  protect,
  authorize('super_admin', 'unit_admin', 'unit_auditor', 'global_auditor'),
  ctrl.getUnitAuditLogs
);

// ── Cascading filter meta endpoints (for dropdown population in Reports UI) ──
// unit_admin / unit_auditor see data from their own unit DB (via req.db)
// super_admin / global_auditor pass ?unit_db= to target a specific unit's DB
router.get('/meta/units',       protect, authorize(...adminOrAuditor), ctrl.getMetaUnits);
router.get('/meta/departments', protect, authorize(...adminOrAuditor), ctrl.getMetaDepartments);
router.get('/meta/employees',   protect, authorize(...adminOrAuditor), ctrl.getMetaEmployees);

// ── Tabbed Data Reports ──────────────────────────────────────────────────────

// Employee-wise: unit_admin / unit_auditor / super_admin / global_auditor only
router.get(
  '/employee-wise',
  protect,
  authorize(...adminOrAuditor),
  ctrl.getEmployeeWiseReport
);

// Department-wise: unit_admin+ only
router.get(
  '/department-wise',
  protect,
  authorize(...adminOrAuditor),
  ctrl.getDepartmentWiseReport
);

// Unit/Office-wise: unit_admin+ only
router.get(
  '/unit-wise',
  protect,
  authorize(...adminOrAuditor),
  ctrl.getUnitWiseReport
);

// Rejected / Not Allowed: unit_admin+ only
router.get(
  '/rejected',
  protect,
  authorize(...adminOrAuditor),
  ctrl.getRejectedReport
);

// Active & Expected: security + receptionist + unit_admin+
router.get(
  '/active-expected',
  protect,
  authorize('super_admin', 'global_auditor', 'unit_admin', 'unit_auditor', 'security', 'receptionist'),
  ctrl.getActiveExpectedReport
);

// Detailed Visit History: unit_admin+ only
router.get(
  '/visit-history',
  protect,
  authorize(...adminOrAuditor),
  ctrl.getDetailedVisitHistory
);

module.exports = router;

