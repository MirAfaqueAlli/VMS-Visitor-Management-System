// backend/services/notification.service.js
'use strict';

const { centralPool, getPool, dbNameOf } = require('./dbManager');
const whatsapp     = require('./whatsapp.service');
const push         = require('./push.service');
const { emitToVisitorPhone } = require('../socket/socketManager');
const { enqueueMessage }     = require('./messageQueue.service');

/**
 * Records a notification and queues its delivery (services/messageQueue.service): the
 * caller never waits for SMTP or the SMS / WhatsApp gateway. The queue's workers send it
 * — in order, a few at a time, retrying temporary failures — and set the row SENT or
 * FAILED. Never throws.
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
 * @param {'EMAIL'|'SMS'|'WHATSAPP'|'DASHBOARD'} opts.type
 * @param {string|null}  opts.subject
 * @param {string}       opts.message
 * @param {object|null}  opts.gatePass        — the gate pass to send with it ({ gate_pass_id, pass_number,
 *                                              qr_code_path } from generateGatePass). Stored as a reference
 *                                              and built when sent: EMAIL attaches the real gate pass (its QR
 *                                              in the body where the HTML has cid:gatepass-qr). On WhatsApp the
 *                                              pass PDF follows the message as a document of its own, so the
 *                                              message arrives even if the document can't be delivered.
 * @param {object|null}  opts.gatePassDb      — the pool the pass was issued in, when not `db`
 * @param {string|null}  opts.whatsappMedia   — a ready media link for the WhatsApp copy (instead of gatePass)
 * @param {string|null}  opts.whatsappMessage — text for the WhatsApp copy (whatsapp.whatsappText); without
 *                                              it the SMS text is put in the standard layout. (SMS text is
 *                                              fixed by DLT templates; WhatsApp can say more.)
 * @param {{title: string, body?: string, url?: string}|null} opts.push
 *                                            — SMS to a visitor (no recipientUserId) only: the notification
 *                                              pushed to their visitor-portal account. Without it the SMS
 *                                              text is pushed under the subject or "OHPC VMS".
 * @returns {Promise<{ queued: boolean }>}
 *
 * Every SMS is also sent on WhatsApp (as its own WHATSAPP notification row) when
 * Wishper is configured — see whatsapp.service.
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
  gatePass          = null,
  gatePassDb        = null,
  whatsappMedia     = null,
  whatsappMessage   = null,
  push: pushMsg     = null,
}) => {
  // ── 1. Resolve which DB pool to write the notification into ─────────────────
  let unitDb = db;

  if (!unitDb && visitRequestId) {
    try {
      // Walk central to find which unit owns this visit_request
      const [unitRows] = await centralPool.query(
        `SELECT u.db_name FROM units u
         JOIN unit_visit_request_map uvm ON uvm.unit_id = u.id
         WHERE uvm.visit_request_id = ? LIMIT 1`,
        [visitRequestId]
      );
      if (unitRows.length) unitDb = getPool(unitRows[0].db_name);
    } catch (_) { /* delivered without a row */ }
  }

  // ── 2. Record it (PENDING until the queue has sent it) ──────────────────────
  // If we still can't resolve the DB, skip the record but still deliver
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
  const setStatus = async (ok, reason = null) => {
    if (!unitDb || !notificationId) return;
    try {
      await unitDb.query(
        ok ? "UPDATE notifications SET status = 'SENT', sent_at = NOW() WHERE id = ?"
           : "UPDATE notifications SET status = 'FAILED', failure_reason = ? WHERE id = ?",
        ok ? [notificationId] : [reason, notificationId]
      );
    } catch (err) {
      console.error('[NotificationService] Failed to update notification status:', err.message);
    }
  };

  // ── 3. Visitor SMS → at once: live in their open visitor portal, and a system
  //       notification on their devices (staff get theirs from their own socket events)
  if (type === 'SMS' && recipientPhone && !recipientUserId) {
    const visitorMsg = {
      title: pushMsg?.title || subject || 'OHPC VMS',
      body:  pushMsg?.body  || String(message || '').replace(/^(OHPC )?VMS( reminder)?:\s*/i, ''),
      url:   pushMsg?.url,
      tag:   visitRequestId ? `visit-${visitRequestId}` : undefined,   // the latest news about a visit replaces older
    };
    emitToVisitorPhone(recipientPhone, { ...visitorMsg, visit_request_id: visitRequestId });
    push.pushToVisitorPhone(recipientPhone, visitorMsg);   // never throws; not waited for
  }

  // ── 4. Queue the delivery ───────────────────────────────────────────────────
  const unitDbName = dbNameOf(unitDb);
  const passRef = gatePass?.gate_pass_id
    ? {
        unitDb: dbNameOf(gatePassDb || unitDb), gatePassId: gatePass.gate_pass_id,
        passNumber: gatePass.pass_number || null, qrCodePath: gatePass.qr_code_path || null,
      }
    : null;
  let queued = false;
  try {
    if (type === 'DASHBOARD') {
      await setStatus(true);   // read straight from the table — nothing to send
    } else if (type === 'EMAIL') {
      if (!recipientEmail) throw new Error('recipientEmail required for EMAIL notifications');
      await enqueueMessage({
        channel: 'EMAIL', unitDb: unitDbName, notificationId,
        payload: { to: recipientEmail, subject: subject || 'VMS Notification', html: message, gatePass: passRef?.unitDb ? passRef : null },
      });
      queued = true;
    } else if (type === 'SMS') {
      if (!recipientPhone) throw new Error('recipientPhone required for SMS notifications');
      await enqueueMessage({ channel: 'SMS', unitDb: unitDbName, notificationId, payload: { phone: recipientPhone, message } });
      queued = true;
    } else if (type === 'WHATSAPP') {
      if (!recipientPhone) throw new Error('recipientPhone required for WHATSAPP notifications');
      // The message on its own…
      await enqueueMessage({ channel: 'WHATSAPP', unitDb: unitDbName, notificationId, payload: { phone: recipientPhone, text: message } });
      // …then the gate pass as a picture of its own, a few seconds later (after the message).
      // If the picture can't be delivered, the visitor still has the message and the portal link.
      if (whatsappMedia || passRef?.unitDb) {
        await enqueueMessage({
          channel: 'WHATSAPP', delaySeconds: 5,
          payload: {
            phone: recipientPhone,
            text: `*Gate pass${passRef?.passNumber ? ` ${passRef.passNumber}` : ''}*\nShow this at the security gate on the day of your visit, with a valid photo ID.`,
            mediaUrl: whatsappMedia || null, gatePass: passRef?.unitDb ? passRef : null,
          },
        });
      }
      queued = true;
    }
  } catch (err) {
    console.error(`[NotificationService] ${type} could not be queued:`, err.message);
    await setStatus(false, `Not queued: ${err.message}`);
  }

  // ── 5. WhatsApp copy of every SMS (its own row, so each channel is tracked) ──
  if (type === 'SMS' && recipientPhone && whatsapp.isWhatsAppConfigured()) {
    await sendNotification({
      db: unitDb, visitRequestId, recipientUserId, recipientPhone,
      type: 'WHATSAPP', subject, message: whatsappMessage || whatsapp.whatsappFromSms(message),
      gatePass, gatePassDb, whatsappMedia,
    });
  }

  return { queued };
};

module.exports = { sendNotification };
