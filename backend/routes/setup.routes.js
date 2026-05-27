// backend/routes/setup.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/setup.controller');

// GET  /api/setup/status — returns { initialized: bool }
router.get('/status', ctrl.getStatus);

// POST /api/setup — one-time init: creates org + super admin
// Only works when system is completely empty (no org, no users)
router.post('/', ctrl.initialize);

module.exports = router;
