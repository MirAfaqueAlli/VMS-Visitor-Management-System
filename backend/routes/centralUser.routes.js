// backend/routes/centralUser.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/centralUser.controller');
const { protect }   = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/rbac.middleware');
const { validate }  = require('../middlewares/validate.middleware');
const { createCentralUserSchema, updateCentralUserSchema } = require('../validators/schemas');

// All central-user routes require super_admin only
router.use(protect, authorize('super_admin'));

// The signed-in super admin's own unit membership (join one unit as an employee/host)
router.get('/me/unit-profile',    ctrl.getMyUnitProfile);
router.put('/me/unit-profile',    ctrl.updateMyUnitProfile);
router.delete('/me/unit-profile', ctrl.removeMyUnitProfile);

router.get('/',        ctrl.listCentralUsers);
router.post('/',       validate(createCentralUserSchema), ctrl.createCentralUser);
router.put('/:id',     validate(updateCentralUserSchema), ctrl.updateCentralUser);
router.delete('/:id',  ctrl.deactivateCentralUser);

module.exports = router;
