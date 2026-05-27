// backend/routes/centralUser.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/centralUser.controller');
const { protect }   = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/rbac.middleware');

// All central-user routes require super_admin only
router.use(protect, authorize('super_admin'));

router.get('/',        ctrl.listCentralUsers);
router.post('/',       ctrl.createCentralUser);
router.put('/:id',     ctrl.updateCentralUser);
router.delete('/:id',  ctrl.deactivateCentralUser);

module.exports = router;
