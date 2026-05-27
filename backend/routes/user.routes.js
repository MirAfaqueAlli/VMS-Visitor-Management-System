// backend/routes/user.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/user.controller');
const { protect, optionalProtect } = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/rbac.middleware');

// Public-ish: list hosts (employees) by department — used by visitor public form
// Supports ?unit_code=HQ for public forms; authenticated requests use req.db
router.get('/hosts', optionalProtect, ctrl.listHosts);

// Protected routes — super_admin or unit_admin
router.get('/',    protect, authorize('super_admin', 'unit_admin'), ctrl.listUsers);
router.get('/:id', protect, authorize('super_admin', 'unit_admin'), ctrl.getUserById);
router.post('/',   protect, authorize('super_admin', 'unit_admin'), ctrl.createUser);
router.put('/:id', protect, authorize('super_admin', 'unit_admin'), ctrl.updateUser);
router.delete('/:id', protect, authorize('super_admin', 'unit_admin'), ctrl.deactivateUser);

module.exports = router;
