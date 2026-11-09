// backend/services/messageQueue.service.js
'use strict';

/**
 * Outgoing message queue — email, SMS and WhatsApp.
 *
 * The standard "outbox + workers" design (what Redis/BullMQ, SQS or RabbitMQ queues give
 * large systems), kept in MySQL so it needs no extra server:
 *
 *  Producer   enqueueMessage() writes the message to vms_central.message_queue and returns
 *             at once — the request that caused it never waits for SMTP or a gateway.
 *  Workers    every server process runs a worker per channel. Workers claim due messages
 *             with SELECT … FOR UPDATE SKIP LOCKED, so two processes (pm2 cluster) never
 *             take the same one, and send up to <CHANNEL>_CONCURRENCY at a time — oldest
 *             first, priority messages (password reset) ahead.
 *  Isolation  each message stands alone: one that fails or throws never stops the next.
 *  Retries    a temporary failure (network, SMTP 4xx, gateway 5xx) is retried with
 *             exponential backoff + jitter (≈30 s, 2 min, 10 min, 30 min); a permanent
 *             one, or the last attempt, ends FAILED with the reason (dead letter).
 *  Durable    a restart or deploy loses nothing. A message left SENDING by a process that
 *             died is put back after 5 minutes (at-least-once delivery).
 *  Tracking   the unit's notifications row goes PENDING → SENT / FAILED.
 *  Files      the queue holds no files. A gate pass is stored as a reference and built
 *             when the message is sent: the email gets the real gate pass attached (and
 *             its QR in the body), WhatsApp a fresh link to it — so a retry never sends
 *             an expired link.
 *  Cleanup    sent rows are deleted after 7 days, failed after 30.
 *
 * Settings (.env): EMAIL_CONCURRENCY (3), SMS_CONCURRENCY (5), WHATSAPP_CONCURRENCY (3),
 * MESSAGE_MAX_ATTEMPTS (5), MESSAGE_WORKERS=false to not send from this process.
 *
 * OTPs are not queued: the person is waiting and must be told at once if it failed.
 */

const os = require('os');
const { centralPool, getPool } = require('./dbManager');
const emailService = require('./email.service');
const smsService   = require('./sms.service');
const whatsapp     = require('./whatsapp.service');

const intEnv = (name, fallback, min = 1) => {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
};

const WORKER_ID     = `${os.hostname()}:${process.pid}`.slice(0, 100);
const MAX_ATTEMPTS  = intEnv('MESSAGE_MAX_ATTEMPTS', 5);
const BACKOFF_S     = [30, 120, 600, 1800];   // after attempt 1, 2, 3, 4+
const POLL_MS       = 3_000;                  // idle check for messages queued by other processes
const STALE_MINUTES = 5;                      // SENDING longer than this → the process died; put back

// ── Gate-pass attachments, built at send time from a reference ─────────────────

/** Loads the gate-pass picture (lazy require: gatePassImage pulls in sharp / S3). */
async function gatePassPng(ref) {
  const { loadPass, renderGatePassPng } = require('./gatePassImage.service');
  const pass = await loadPass(getPool(ref.unitDb), ref.gatePassId);
  return pass?.qr_code_data ? renderGatePassPng(pass) : null;
}

/** The email as sent: the real gate pass attached, its QR in the body. */
async function buildEmail(p) {
  let html = p.html;
  const attachments = [];
  const ref = p.gatePass;
  if (ref?.unitDb && ref.gatePassId) {
    const cidRef = `cid:${emailService.GATE_PASS_QR_CID}`;
    if (html?.includes(cidRef)) {
      const qr = await emailService.gatePassQrAttachment(ref.qrCodePath);
      if (qr) attachments.push(qr);
      else html = html.replace(new RegExp(`<img[^>]*${cidRef}[^>]*>`, 'g'), '');   // no broken image
    }
    try {
      const png = await gatePassPng(ref);
      if (png) attachments.push({ filename: `Gate pass ${ref.passNumber || ''}.png`.replace(' .png', '.png'), content: png, contentType: 'image/png' });
    } catch (err) {
      console.warn('[MessageQueue] gate pass not attached (the QR is in the email):', err.message);
    }
  }
  return { to: p.to, subject: p.subject, html, text: p.text, attachments };
}

// ── Channels ─────────────────────────────────────────────────────────────────

const CHANNELS = {
  EMAIL: {
    concurrency: intEnv('EMAIL_CONCURRENCY', 3),
    send: async (p) => emailService.sendEmail(await buildEmail(p)),
  },
  SMS: {
    concurrency: intEnv('SMS_CONCURRENCY', 5),
    send: (p) => smsService.sendSms(p.phone, p.message),
  },
  WHATSAPP: {
    concurrency: intEnv('WHATSAPP_CONCURRENCY', 3),
    send: async (p) => {
      let mediaUrl = p.mediaUrl || null;
      if (!mediaUrl && p.gatePass?.unitDb) {
        const { gatePassWhatsAppMedia } = require('./gatePassImage.service');
        mediaUrl = await gatePassWhatsAppMedia(getPool(p.gatePass.unitDb), {
          gate_pass_id: p.gatePass.gatePassId, qr_code_path: p.gatePass.qrCodePath,
        });
        // This message *is* the pass — without the picture there's nothing to send yet
        if (!mediaUrl) return { success: false, error: 'The gate-pass picture could not be made or stored.', retryable: true };
      }
      return whatsapp.sendWhatsApp(p.phone, p.text, { mediaUrl });
    },
  },
};

const state = Object.fromEntries(Object.keys(CHANNELS).map((c) => [c, { running: 0, pumping: false, again: false }]));
let started = false;

// ── Producer ─────────────────────────────────────────────────────────────────

/**
 * Queues one message. Resolves to its queue id once it is safely stored.
 *
 * @param {object} o
 * @param {'EMAIL'|'SMS'|'WHATSAPP'} o.channel
 * @param {object}  o.payload        — EMAIL { to, subject, html, text?, gatePass? }
 *                                     SMS { phone, message } · WHATSAPP { phone, text, mediaUrl?, gatePass? }
 *                                     gatePass = { unitDb, gatePassId, passNumber, qrCodePath }
 * @param {number}  [o.priority=0]   — 1 when someone is waiting for it (password reset)
 * @param {string}  [o.unitDb]       — with notificationId: the notifications row to update
 * @param {number}  [o.notificationId]
 * @param {number}  [o.delaySeconds=0] — not before (e.g. so a follow-up goes after the message it follows)
 */
async function enqueueMessage({ channel, payload, priority = 0, unitDb = null, notificationId = null, delaySeconds = 0 }) {
  if (!CHANNELS[channel]) throw new Error(`Unknown message channel: ${channel}`);
  const [r] = await centralPool.query(
    `INSERT INTO message_queue (channel, priority, payload, max_attempts, unit_db, notification_id, available_at)
     VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL ? SECOND))`,
    [channel, priority, JSON.stringify(payload), MAX_ATTEMPTS, unitDb, notificationId, Math.max(0, delaySeconds)]
  );
  if (started) setImmediate(() => pump(channel));   // this process takes it at once; others on their next poll
  return r.insertId;
}

/** Queues an email that isn't tied to a notifications row (e.g. a password reset). */
const queueEmail = (message, { priority = 0 } = {}) =>
  enqueueMessage({ channel: 'EMAIL', payload: message, priority });

// ── Workers ──────────────────────────────────────────────────────────────────

/** Claims up to `limit` due messages for this worker (no other process can take them). */
async function claim(channel, limit) {
  const conn = await centralPool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT id FROM message_queue
       WHERE channel = ? AND status = 'QUEUED' AND available_at <= NOW(3)
       ORDER BY priority DESC, id
       LIMIT ? FOR UPDATE SKIP LOCKED`,
      [channel, limit]
    );
    if (!rows.length) {
      await conn.commit();
      return [];
    }
    const ids = rows.map((r) => r.id);
    await conn.query(
      `UPDATE message_queue SET status = 'SENDING', attempts = attempts + 1, locked_by = ?, locked_at = NOW()
       WHERE id IN (?)`,
      [WORKER_ID, ids]
    );
    const [jobs] = await conn.query(
      `SELECT id, payload, attempts, max_attempts, unit_db, notification_id
       FROM message_queue WHERE id IN (?) ORDER BY priority DESC, id`,
      [ids]
    );
    await conn.commit();
    return jobs;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Updates the unit's notifications row for this message. Never throws. */
async function markNotification(job, ok, reason = null) {
  if (!job.unit_db || !job.notification_id) return;
  try {
    await getPool(job.unit_db).query(
      ok ? "UPDATE notifications SET status = 'SENT', sent_at = NOW(), failure_reason = NULL WHERE id = ?"
         : "UPDATE notifications SET status = 'FAILED', failure_reason = ? WHERE id = ?",
      ok ? [job.notification_id] : [String(reason || '').slice(0, 1000), job.notification_id]
    );
  } catch (err) {
    console.error('[MessageQueue] could not update notification row:', err.message);
  }
}

/** Sends one claimed message and records the outcome. Never throws. */
async function deliver(channel, job) {
  let result;
  try {
    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
    result = await CHANNELS[channel].send(payload);
    if (!result) result = { success: false, error: 'The sender returned nothing.' };
  } catch (err) {
    result = { success: false, error: err?.message || String(err), retryable: true };
  }

  try {
    if (result.success) {
      await centralPool.query(
        "UPDATE message_queue SET status = 'SENT', sent_at = NOW(), locked_by = NULL, last_error = NULL WHERE id = ?", [job.id]
      );
      await markNotification(job, true);
      return;
    }

    const error = String(result.error || 'Delivery failed').slice(0, 1000);
    if (result.retryable && job.attempts < job.max_attempts) {
      const base  = BACKOFF_S[Math.min(job.attempts - 1, BACKOFF_S.length - 1)];
      const delay = Math.round(base * (0.8 + Math.random() * 0.4));   // jitter: retries don't all land together
      await centralPool.query(
        `UPDATE message_queue SET status = 'QUEUED', locked_by = NULL, last_error = ?,
           available_at = DATE_ADD(NOW(3), INTERVAL ? SECOND) WHERE id = ?`,
        [error, delay, job.id]
      );
      console.warn(`[MessageQueue] ${channel} #${job.id} failed (${error}) — attempt ${job.attempts}/${job.max_attempts}, retrying in ${delay}s.`);
      return;
    }

    await centralPool.query(
      "UPDATE message_queue SET status = 'FAILED', locked_by = NULL, last_error = ? WHERE id = ?", [error, job.id]
    );
    await markNotification(job, false, error);
    console.error(`[MessageQueue] ${channel} #${job.id} failed for good after ${job.attempts} attempt(s): ${error}`);
  } catch (err) {
    // The row stays SENDING; the stale-lock sweep puts it back
    console.error(`[MessageQueue] could not record the outcome of ${channel} #${job.id}:`, err.message);
  }
}

/** Fills this channel's free slots with due messages. Re-entrant calls just ask for another round. */
async function pump(channel) {
  const st = state[channel];
  if (st.pumping) { st.again = true; return; }
  st.pumping = true;
  try {
    do {
      st.again = false;
      const free = CHANNELS[channel].concurrency - st.running;
      if (free <= 0) break;
      const jobs = await claim(channel, free);
      for (const job of jobs) {
        st.running++;
        deliver(channel, job).finally(() => {
          st.running--;
          pump(channel);
        });
      }
      if (jobs.length === free) st.again = true;   // there may be more waiting
    } while (st.again);
  } catch (err) {
    console.error(`[MessageQueue] ${channel} worker:`, err.message);
  } finally {
    st.pumping = false;
  }
}

/** Puts back messages whose sender died mid-send, and removes old rows. */
async function housekeeping() {
  try {
    const [back] = await centralPool.query(
      `UPDATE message_queue SET status = 'QUEUED', locked_by = NULL, available_at = NOW(3)
       WHERE status = 'SENDING' AND locked_at < NOW() - INTERVAL ? MINUTE`,
      [STALE_MINUTES]
    );
    if (back.affectedRows) console.warn(`[MessageQueue] ${back.affectedRows} interrupted message(s) put back in the queue.`);
    await centralPool.query(
      `DELETE FROM message_queue
       WHERE (status = 'SENT' AND created_at < NOW() - INTERVAL 7 DAY)
          OR (status = 'FAILED' AND created_at < NOW() - INTERVAL 30 DAY)
       LIMIT 5000`
    );
  } catch (err) {
    console.error('[MessageQueue] housekeeping:', err.message);
  }
}

/** Starts this process's workers. Call once after the server starts. */
function startMessageWorkers() {
  if (started) return;
  if (process.env.MESSAGE_WORKERS === 'false') {
    console.log('[MessageQueue] Workers off in this process (MESSAGE_WORKERS=false) — messages are queued only.');
    return;
  }
  started = true;
  const pumpAll = () => Object.keys(CHANNELS).forEach((c) => pump(c));
  setTimeout(pumpAll, 1_000).unref();
  setInterval(pumpAll, POLL_MS).unref();
  setTimeout(housekeeping, 15_000).unref();
  setInterval(housekeeping, 60_000).unref();
  console.log(`[MessageQueue] Workers started — email ${CHANNELS.EMAIL.concurrency}, SMS ${CHANNELS.SMS.concurrency}, WhatsApp ${CHANNELS.WHATSAPP.concurrency} at a time.`);
}

/** Queue counts by channel and status (for logs / admin checks). */
async function queueStats() {
  const [rows] = await centralPool.query(
    'SELECT channel, status, COUNT(*) AS n FROM message_queue GROUP BY channel, status'
  );
  return rows;
}

module.exports = { enqueueMessage, queueEmail, startMessageWorkers, queueStats };
