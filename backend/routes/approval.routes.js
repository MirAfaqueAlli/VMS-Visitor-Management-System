// backend/routes/approval.routes.js
'use strict';

const express = require('express');
const router = express.Router();
const approvalController = require('../controllers/approval.controller');
const { protect } = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/rbac.middleware');

router.get('/inbox',       protect, authorize('org_admin', 'dept_admin', 'employee'), approvalController.getInbox);
router.put('/:id/approve', protect, authorize('org_admin', 'dept_admin', 'employee'), approvalController.approveRequest);
router.put('/:id/reject',  protect, authorize('org_admin', 'dept_admin', 'employee'), approvalController.rejectRequest);

module.exports = router;
