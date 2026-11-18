// backend/routes/approval.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/approval.controller');
const { protect }   = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/rbac.middleware');
const { validate }  = require('../middlewares/validate.middleware');
const { approveSchema, rejectSchema } = require('../validators/schemas');

// Inbox: any authenticated user who can be a host + auditors
router.get('/inbox', protect, authorize('super_admin', 'unit_admin', 'employee', 'unit_auditor', 'global_auditor'), ctrl.getInbox);

// Notifications for logged-in user
router.get('/notifications', protect, ctrl.getUserNotifications);

// Approve / Reject: host or unit_admin. A super admin acting as their unit employee
// profile can also decide those requests.
router.put('/:id/approve', protect, authorize('super_admin', 'unit_admin', 'employee'), validate(approveSchema), ctrl.approveRequest);
router.put('/:id/reject',  protect, authorize('super_admin', 'unit_admin', 'employee'), validate(rejectSchema), ctrl.rejectRequest);

module.exports = router;
