// backend/routes/designation.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/designation.controller');
const { protect }   = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/rbac.middleware');

// GET /api/designations?department_id=X — any authenticated unit user
router.get('/', protect, ctrl.listDesignations);

// POST /api/designations/bulk — unit_admin or super_admin only
router.post('/bulk', protect, authorize('super_admin', 'unit_admin'), ctrl.bulkCreateDesignations);

// PUT /api/designations/:id — unit_admin or super_admin only
router.put('/:id', protect, authorize('super_admin', 'unit_admin'), ctrl.updateDesignation);

// DELETE /api/designations/:id — unit_admin or super_admin only
router.delete('/:id', protect, authorize('super_admin', 'unit_admin'), ctrl.deactivateDesignation);

module.exports = router;
