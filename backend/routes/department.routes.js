// backend/routes/department.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/department.controller');
const { protect }   = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/rbac.middleware');

// Public: list departments for visitor form (no auth) — supports ?organization_id=
router.get('/public', ctrl.listPublicDepartments);

// Also expose on base path as public (same handler) — used by PublicRequest.jsx
// The protect middleware comes AFTER so unauthed requests with org_id param still work
router.get('/', (req, res, next) => {
  // If the request has organization_id query param and no Authorization header, treat as public
  if (req.query.organization_id && !req.headers.authorization) {
    return ctrl.listPublicDepartments(req, res);
  }
  next(); // fall through to protected route below
}, protect, ctrl.listDepartments);

// org_admin only: create / update / deactivate departments
router.post('/',      protect, authorize('org_admin'), ctrl.createDepartment);
router.put('/:id',    protect, authorize('org_admin'), ctrl.updateDepartment);
router.delete('/:id', protect, authorize('org_admin'), ctrl.deactivateDepartment);

module.exports = router;
