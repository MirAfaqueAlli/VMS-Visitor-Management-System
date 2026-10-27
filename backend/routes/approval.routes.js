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

// Approve / Reject: host or unit_admin. Central users (super_admin) oversee units
// but don't take operational decisions inside them (segregation of duties) —
// and their ids aren't valid actors in a unit DB (approved_by / acted_by_user_id).
router.put('/:id/approve', protect, authorize('unit_admin', 'employee'), validate(approveSchema), ctrl.approveRequest);
router.put('/:id/reject',  protect, authorize('unit_admin', 'employee'), validate(rejectSchema), ctrl.rejectRequest);

module.exports = router;
