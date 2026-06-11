// backend/routes/publicAuth.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/publicAuth.controller');

// All public — no authentication middleware required
router.post('/send-phone-otp',   ctrl.sendPhoneOtp);
router.post('/verify-phone-otp', ctrl.verifyPhoneOtp);
router.post('/send-email-otp',   ctrl.sendEmailOtp);
router.post('/verify-email-otp', ctrl.verifyEmailOtp);

module.exports = router;
