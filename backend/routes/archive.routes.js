// backend/routes/archive.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/archive.controller');
const { protect }   = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/rbac.middleware');

// Only unit_admin and super_admin can manage archives
const ARCHIVE_ROLES = ['unit_admin', 'super_admin'];

router.get   ('/',                protect, authorize(...ARCHIVE_ROLES), ctrl.getStatus);
router.post  ('/run',             protect, authorize(...ARCHIVE_ROLES), ctrl.runArchive);
router.get   ('/:fy/download',    protect, authorize(...ARCHIVE_ROLES), ctrl.downloadArchive);
router.delete('/:fy/purge',       protect, authorize(...ARCHIVE_ROLES), ctrl.purgeArchive);

module.exports = router;
