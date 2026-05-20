// backend/routes/user.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/user.controller');
const { protect }    = require('../middlewares/auth.middleware');
const { authorize }  = require('../middlewares/rbac.middleware');

// Public-ish: list hosts (employees) by department — used by visitor public form
// No auth required so external visitors can pick their host
router.get('/hosts', ctrl.listHosts);

// Protected routes — org_admin or dept_admin only
router.get('/',    protect, authorize('org_admin', 'dept_admin'), ctrl.listUsers);
router.get('/:id', protect, authorize('org_admin', 'dept_admin'), ctrl.getUserById);
router.post('/',   protect, authorize('org_admin', 'dept_admin'), ctrl.createUser);
router.put('/:id', protect, authorize('org_admin', 'dept_admin'), ctrl.updateUser);
router.delete('/:id', protect, authorize('org_admin', 'dept_admin'), ctrl.deactivateUser);

module.exports = router;
