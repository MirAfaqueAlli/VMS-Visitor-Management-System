// backend/routes/department.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/department.controller');
const { protect }   = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/rbac.middleware');

// Public — external visitor form (no auth required, uses unit_code or unit_id query param)
router.get('/public', ctrl.listPublicDepartments);

// Authenticated list — falls back to public if unit_code/unit_id is provided without auth
router.get('/', (req, res, next) => {
  if ((req.query.unit_code || req.query.unit_id) && !req.headers.authorization) {
    return ctrl.listPublicDepartments(req, res);
  }
  next();
}, protect, ctrl.listDepartments);

// Create/Update/Delete — super_admin or unit_admin
router.post('/',      protect, authorize('super_admin', 'unit_admin'), ctrl.createDepartment);
router.put('/:id',    protect, authorize('super_admin', 'unit_admin'), ctrl.updateDepartment);
router.delete('/:id', protect, authorize('super_admin', 'unit_admin'), ctrl.deactivateDepartment);

module.exports = router;
