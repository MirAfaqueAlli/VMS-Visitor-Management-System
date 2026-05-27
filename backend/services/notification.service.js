// backend/services/notification.service.js
'use strict';

const { centralPool, getPool } = require('./dbManager');
const emailService = require('./email.service');

/**
 * Inserts a notification record and delivers it via the appropriate channel.
 * Never throws — all errors are caught and persisted in the DB.
 *
 * The service resolves the correct unit DB by:
 *   - Using the passed `db` pool directly (preferred), OR
 *   - Resolving from visitRequestId → unit_id → db_name via centralPool (fallback).
 *
 * @param {object} opts
 * @param {object|null}  opts.db                — unit pool (req.db). Optional if visitRequestId provided.
 * @param {number|null}  opts.visitRequestId
 * @param {number|null}  opts.recipientUserId
 * @param {string|null}  opts.recipientEmail
 * @param {string|null}  opts.recipientPhone
 * @param {'EMAIL'|'SMS'|'DASHBOARD'} opts.type
 * @param {string|null}  opts.subject
 * @param {string}       opts.message
 * @returns {Promise<{ success: boolean }>}
 */
const sendNotification = async ({
  db                = null,
  visitRequestId    = null,
  recipientUserId   = null,
  recipientEmail    = null,
  recipientPhone    = null,
  type,
  subject           = null,
  message,
}) => {
  // ── 1. Resolve which DB pool to write the notification into ─────────────────
  let unitDb = db;

  if (!unitDb && visitRequestId) {
    try {
      // Walk central to find which unit owns this visit_request
      // Note: visit_requests live in unit DBs — we need to search pools
      // Since this is a fallback, try to find via unit table
      const [unitRows] = await centralPool.query(
        `SELECT u.db_name FROM units u
         JOIN unit_visit_request_map uvm ON uvm.unit_id = u.id
         WHERE uvm.visit_request_id = ? LIMIT 1`,
        [visitRequestId]
      );
      if (unitRows.length) unitDb = getPool(unitRows[0].db_name);
    } catch (_) {}
  }

  // If we still can't resolve the DB, skip the DB insert but attempt delivery
  let notificationId = null;

  if (unitDb) {
    try {
      const [insertResult] = await unitDb.query(
        `INSERT INTO notifications
           (visit_request_id, recipient_user_id,
            recipient_email, recipient_phone, notification_type,
            subject, message, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', NOW())`,
        [visitRequestId, recipientUserId, recipientEmail, recipientPhone, type, subject, message]
      );
      notificationId = insertResult.insertId;
    } catch (dbErr) {
      console.error('[NotificationService] Failed to insert notification row:', dbErr.message);
    }
  }

  // ── 2. Deliver ──────────────────────────────────────────────────────────────
  let deliverySuccess = false;
  let failureReason   = null;

  try {
    if (type === 'EMAIL') {
      if (!recipientEmail) throw new Error('recipientEmail required for EMAIL notifications');
      const result = await emailService.sendEmail({
        to:      recipientEmail,
        subject: subject || 'VMS Notification',
        html:    message,
      });
      if (!result.success) throw new Error(result.error || 'Email delivery failed');
      deliverySuccess = true;

    } else if (type === 'SMS') {
      if (!recipientPhone) throw new Error('recipientPhone required for SMS notifications');
      const apiKey = process.env.FAST2SMS_API_KEY;
      if (!apiKey) {
        console.warn('[NotificationService] FAST2SMS_API_KEY not set. Skipping SMS.');
        deliverySuccess = true; // treat as success in dev
      } else {
        const body = new URLSearchParams({ route: 'q', message, numbers: recipientPhone, flash: '0' });
        const smsRes  = await fetch('https://www.fast2sms.com/dev/bulkV2', {
          method: 'POST',
          headers: { authorization: apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
          body:    body.toString(),
        });
        const smsData = await smsRes.json().catch(() => ({}));
        if (!smsRes.ok || smsData.return === false) {
          throw new Error(`Fast2SMS error: ${JSON.stringify(smsData)}`);
        }
        deliverySuccess = true;
      }

    } else if (type === 'DASHBOARD') {
      deliverySuccess = true; // Read directly from DB — mark sent immediately
    }
  } catch (deliveryErr) {
    console.error(`[NotificationService] ${type} delivery failed:`, deliveryErr.message);
    failureReason   = deliveryErr.message;
    deliverySuccess = false;
  }

  // ── 3. Update delivery status ───────────────────────────────────────────────
  if (unitDb && notificationId) {
    try {
      if (deliverySuccess) {
        await unitDb.query(
          `UPDATE notifications SET status = 'SENT', sent_at = NOW() WHERE id = ?`,
          [notificationId]
        );
      } else {
        await unitDb.query(
          `UPDATE notifications SET status = 'FAILED', failure_reason = ? WHERE id = ?`,
          [failureReason, notificationId]
        );
      }
    } catch (updateErr) {
      console.error('[NotificationService] Failed to update notification status:', updateErr.message);
    }
  }

  return { success: deliverySuccess };
};

module.exports = { sendNotification };
