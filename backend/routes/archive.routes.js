// backend/routes/archive.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/archive.controller');
const { protect }   = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/rbac.middleware');

// Only unit_admin and super_admin can manage archives
const ARCHIVE_ROLES = ['unit_admin', 'super_admin'];

// ── Global (super-admin only) — must come BEFORE /:fy to avoid param conflicts ─
router.get   ('/global',              protect, authorize('super_admin'), ctrl.getGlobalStatus);
router.post  ('/global/run',          protect, authorize('super_admin'), ctrl.runGlobalArchive);
router.get   ('/global/:fy/download', protect, authorize('super_admin'), ctrl.downloadGlobalArchive);
router.delete('/global/:fy/purge',    protect, authorize('super_admin'), ctrl.purgeGlobalArchive);

// ── Per-unit (unit_admin + super_admin managing a unit via X-Unit-Db header) ──
router.get   ('/',                protect, authorize(...ARCHIVE_ROLES), ctrl.getStatus);
router.post  ('/run',             protect, authorize(...ARCHIVE_ROLES), ctrl.runArchive);
router.get   ('/:fy/download',    protect, authorize(...ARCHIVE_ROLES), ctrl.downloadArchive);
router.delete('/:fy/purge',       protect, authorize(...ARCHIVE_ROLES), ctrl.purgeArchive);

module.exports = router;

