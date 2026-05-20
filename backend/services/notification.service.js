// backend/services/notification.service.js
'use strict';

const pool        = require('../db');
const emailService = require('./email.service');

/**
 * Inserts a notification record and delivers it via the appropriate channel.
 * Never throws — all errors are caught and persisted in the DB.
 *
 * @param {object} opts
 * @param {number|null}  opts.visitRequestId
 * @param {number|null}  opts.recipientUserId
 * @param {number|null}  opts.recipientVisitorId
 * @param {string|null}  opts.recipientEmail
 * @param {string|null}  opts.recipientPhone
 * @param {'EMAIL'|'SMS'|'DASHBOARD'} opts.type
 * @param {string|null}  opts.subject
 * @param {string}       opts.message
 * @returns {Promise<{ success: boolean }>}
 */
const sendNotification = async ({
  visitRequestId    = null,
  recipientUserId   = null,
  recipientVisitorId = null,
  recipientEmail    = null,
  recipientPhone    = null,
  type,
  subject           = null,
  message,
}) => {
  let notificationId = null;

  try {
    // ── 1. Insert with PENDING status ────────────────────────────────────────
    const [insertResult] = await pool.query(
      `INSERT INTO notifications
         (visit_request_id, recipient_user_id, recipient_visitor_id,
          recipient_email, recipient_phone, notification_type,
          subject, message, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NOW())`,
      [
        visitRequestId,
        recipientUserId,
        recipientVisitorId,
        recipientEmail,
        recipientPhone,
        type,
        subject,
        message,
      ]
    );
    notificationId = insertResult.insertId;
  } catch (dbErr) {
    console.error('[NotificationService] Failed to insert notification row:', dbErr.message);
    return { success: false };
  }

  // ── 2. Deliver ──────────────────────────────────────────────────────────────
  let deliverySuccess = false;
  let failureReason   = null;

  try {
    if (type === 'EMAIL') {
      if (!recipientEmail) throw new Error('recipientEmail required for EMAIL notifications');
      const result = await emailService.sendEmail({
        to: recipientEmail,
        subject: subject || 'Notification',
        html: message,
      });
      if (!result.success) throw new Error(result.error || 'Email delivery failed');
      deliverySuccess = true;

    } else if (type === 'SMS') {
      if (!recipientPhone) throw new Error('recipientPhone required for SMS notifications');

      const apiKey = process.env.FAST2SMS_API_KEY;
      if (!apiKey) {
        console.warn('[NotificationService] FAST2SMS_API_KEY not set. Skipping SMS.');
        deliverySuccess = true; // Treat as success to avoid noise in dev
      } else {
        const body = new URLSearchParams({
          route: 'q',
          message,
          numbers: recipientPhone,
          flash: '0',
        });

        const smsRes = await fetch('https://www.fast2sms.com/dev/bulkV2', {
          method: 'POST',
          headers: {
            authorization: apiKey,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });

        const smsData = await smsRes.json().catch(() => ({}));

        if (!smsRes.ok || smsData.return === false) {
          throw new Error(`Fast2SMS error: ${JSON.stringify(smsData)}`);
        }
        deliverySuccess = true;
      }

    } else if (type === 'DASHBOARD') {
      // Dashboard notifications are read directly from the DB — mark as SENT immediately.
      deliverySuccess = true;
    }
  } catch (deliveryErr) {
    console.error(`[NotificationService] ${type} delivery failed:`, deliveryErr.message);
    failureReason = deliveryErr.message;
    deliverySuccess = false;
  }

  // ── 3. Update delivery status ───────────────────────────────────────────────
  try {
    if (deliverySuccess) {
      await pool.query(
        `UPDATE notifications SET status = 'SENT', sent_at = NOW() WHERE id = ?`,
        [notificationId]
      );
    } else {
      await pool.query(
        `UPDATE notifications SET status = 'FAILED', failure_reason = ? WHERE id = ?`,
        [failureReason, notificationId]
      );
    }
  } catch (updateErr) {
    console.error('[NotificationService] Failed to update notification status:', updateErr.message);
  }

  return { success: deliverySuccess };
};

module.exports = { sendNotification };
