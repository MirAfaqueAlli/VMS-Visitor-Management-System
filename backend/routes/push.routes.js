// backend/routes/push.routes.js
'use strict';

// Browser push subscriptions for signed-in staff (system notifications — see services/push.service).
//   GET  /api/push/public-key   the VAPID public key the browser subscribes with
//   POST /api/push/subscribe    { subscription }  — this browser / device, for the signed-in user
//   POST /api/push/unsubscribe  { endpoint }      — on sign-out or when notifications are turned off

const express = require('express');
const router  = express.Router();
const { protect } = require('../middlewares/auth.middleware');
const { sendSuccess, sendError } = require('../utils/response.util');
const push = require('../services/push.service');

router.get('/public-key', protect, async (req, res) => {
  try {
    return sendSuccess(res, { public_key: await push.publicKey() }, 'Push key.');
  } catch (err) {
    console.error('[Push] public-key error:', err.message);
    return sendError(res, 'Push notifications are not available right now.', 503);
  }
});

router.post('/subscribe', protect, async (req, res) => {
  try {
    await push.saveSubscription(req.user.id, req.user.unit_db || 'central', req.body?.subscription, req.headers['user-agent']);
    return sendSuccess(res, null, 'Notifications are on for this device.');
  } catch (err) {
    console.error('[Push] subscribe error:', err.message);
    return sendError(res, 'Could not turn on notifications for this device.', 400);
  }
});

router.post('/unsubscribe', protect, async (req, res) => {
  try {
    await push.removeSubscription(req.body?.endpoint);
    return sendSuccess(res, null, 'Notifications are off for this device.');
  } catch (err) {
    console.error('[Push] unsubscribe error:', err.message);
    return sendError(res, 'Could not turn off notifications.', 500);
  }
});

module.exports = router;
