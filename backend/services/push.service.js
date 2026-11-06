// backend/services/push.service.js
'use strict';

/**
 * Browser push — system notifications that arrive while the app is minimised,
 * the tab is closed, or the phone is locked (Chrome / Edge / Firefox on desktop,
 * Chrome on Android, Safari on iOS 16.4+ when the app is added to the home screen).
 *
 * Every live socket event that should reach a person (socketManager.emitToUser /
 * emitToUnitSecurity) is also pushed to their subscribed browsers; the service
 * worker (frontend/public/sw.js) shows it only when no VMS window is in view, so
 * an open app never shows it twice.
 *
 * Visitor portal accounts subscribe too (push_subscriptions.unit_db = 'visitor',
 * user_id = visitor_accounts.id): every message a visitor gets by SMS — submitted,
 * approved, declined, cancelled, the visit-day reminder — is also pushed to the
 * portal account that owns that (OTP-verified) mobile number. See pushToVisitorPhone.
 *
 * VAPID keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in .env, or — when not set — a
 * pair generated once and kept in vms_central.app_settings.
 */

const webpush = require('web-push');
const { centralPool, getPool } = require('./dbManager');

let vapidReady = null;   // Promise<{ publicKey }>

/** Loads (or creates once) the VAPID key pair and configures web-push. */
function vapid() {
  if (!vapidReady) {
    vapidReady = (async () => {
      let publicKey  = process.env.VAPID_PUBLIC_KEY;
      let privateKey = process.env.VAPID_PRIVATE_KEY;
      if (!publicKey || !privateKey) {
        const [rows] = await centralPool.query(
          "SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN ('vapid_public_key', 'vapid_private_key')"
        );
        const saved = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
        if (saved.vapid_public_key && saved.vapid_private_key) {
          publicKey = saved.vapid_public_key;
          privateKey = saved.vapid_private_key;
        } else {
          const keys = webpush.generateVAPIDKeys();
          // INSERT IGNORE: if another process got there first, keep (and re-read) theirs
          await centralPool.query(
            "INSERT IGNORE INTO app_settings (setting_key, setting_value) VALUES ('vapid_public_key', ?), ('vapid_private_key', ?)",
            [keys.publicKey, keys.privateKey]
          );
          const [again] = await centralPool.query(
            "SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN ('vapid_public_key', 'vapid_private_key')"
          );
          const kept = Object.fromEntries(again.map((r) => [r.setting_key, r.setting_value]));
          publicKey = kept.vapid_public_key;
          privateKey = kept.vapid_private_key;
        }
      }
      // Contact for the push services: must be https: or mailto: (a local http:// address isn't accepted)
      const contact = [process.env.VAPID_SUBJECT, process.env.CLIENT_URL]
        .find((c) => c && (c.startsWith('https://') || c.startsWith('mailto:'))) || 'mailto:noreply@ohpc.co.in';
      webpush.setVapidDetails(contact, publicKey, privateKey);
      return { publicKey };
    })().catch((err) => {
      vapidReady = null;   // try again next time
      throw err;
    });
  }
  return vapidReady;
}

const publicKey = async () => (await vapid()).publicKey;

/** push_subscriptions.unit_db for visitor portal accounts (staff use 'central' or a unit DB name). */
const VISITOR_SCOPE = 'visitor';

/** Saves (or moves to this user) a browser's subscription. */
async function saveSubscription(userId, unitDb, sub, userAgent) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw new Error('Invalid push subscription.');
  await centralPool.query(
    `INSERT INTO push_subscriptions (user_id, unit_db, endpoint, p256dh, auth, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), unit_db = VALUES(unit_db),
       p256dh = VALUES(p256dh), auth = VALUES(auth), user_agent = VALUES(user_agent)`,
    [userId, unitDb || 'central', String(sub.endpoint).slice(0, 700), sub.keys.p256dh, sub.keys.auth, String(userAgent || '').slice(0, 255)]
  );
}

/** Forgets a browser's subscription; with `owner`, only if it belongs to that user / visitor account. */
async function removeSubscription(endpoint, owner = null) {
  if (!endpoint) return;
  if (owner) {
    await centralPool.query('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ? AND unit_db = ?',
      [String(endpoint).slice(0, 700), owner.userId, owner.unitDb]);
    return;
  }
  await centralPool.query('DELETE FROM push_subscriptions WHERE endpoint = ?', [String(endpoint).slice(0, 700)]);
}

/** What a socket event says as a notification, or null for events that don't notify. */
function messageFor(event, d = {}) {
  const who  = d.visitor_name || 'A visitor';
  const date = d.visit_date ? ` on ${String(d.visit_date).slice(0, 10)}` : '';
  const reqUrl = d.visit_request_id
    ? `/requests/${d.visit_request_id}${d.cross_unit_id ? `?unit_id=${d.cross_unit_id}` : ''}` : '/dashboard';
  switch (event) {
    case 'visit:request:new':
      return d.visit_category === 'SPOT'
        ? { title: 'Walk-in visitor waiting', body: `${who} is at the gate / reception waiting for your approval.`, url: '/approvals', tag: `req-${d.visit_request_id}` }
        : { title: 'New visit request to approve', body: `${who} has requested a visit${date}.`, url: '/approvals', tag: `req-${d.visit_request_id}` };
    case 'visit:approved':
      if (d.visit_category === 'SPOT') {
        return { title: 'Walk-in approved', body: `${who} was approved${d.approved_by ? ` by ${d.approved_by}` : ''}${d.pass_number ? ` · Gate pass ${d.pass_number}` : ''} — they can be checked in now.`, url: d.pass_number ? `/passes/pass/${d.pass_number}` : reqUrl, tag: `appr-${d.visit_request_id}` };
      }
      return d.is_hosted
        ? { title: 'You are invited for a visit', body: `${d.approved_by || d.host_name || 'A colleague'} has hosted you${date}${d.pass_number ? ` · Gate pass ${d.pass_number}` : ''}.`, url: reqUrl, tag: `appr-${d.visit_request_id}` }
        : { title: 'Visit approved', body: `Your visit${date} was approved${d.approved_by ? ` by ${d.approved_by}` : ''}${d.pass_number ? ` · Gate pass ${d.pass_number}` : ''}.`, url: reqUrl, tag: `appr-${d.visit_request_id}` };
    case 'visit:rejected':
      if (d.visit_category === 'SPOT') {
        return { title: 'Walk-in declined', body: `${who} was declined${d.rejected_by ? ` by ${d.rejected_by}` : ''}${d.remarks ? `: “${d.remarks}”` : '.'}`, url: reqUrl, tag: `rej-${d.visit_request_id}` };
      }
      return { title: 'Visit request declined', body: `Your visit request was declined${d.remarks ? `: “${d.remarks}”` : '.'}`, url: reqUrl, tag: `rej-${d.visit_request_id}` };
    case 'visit:approved:today':
      return { title: 'Visitor expected today', body: `${who}${d.host_name ? ` to meet ${d.host_name}` : ''} is approved for today.`, url: '/dashboard', tag: `today-${d.id || d.visit_request_id}` };
    case 'visit:checkin':
      return { title: 'Visitor arrived', body: `${who} has checked in${d.host_name ? ` to meet ${d.host_name}` : ''}.`, url: '/dashboard', tag: `in-${d.visit_request_id}` };
    case 'visit:checkout':
      return { title: 'Visitor checked out', body: `${who} has checked out.`, url: '/dashboard', tag: `out-${d.visit_request_id}` };
    case 'visit:conflict:meeting':
      return { title: 'Host already in a meeting', body: `${d.host_name || 'The host'} is already meeting ${d.conflicting_visitor_name || 'a visitor'}.`, url: '/dashboard', tag: `conflict-${d.visit_request_id}` };
    case 'visit:cancelled':
      return { title: 'Visit cancelled', body: `The visit of ${who}${date} was cancelled.`, url: '/dashboard', tag: `cancel-${d.visit_request_id}` };
    default:
      return null;
  }
}

/** Sends one payload to every subscription in `rows`; drops subscriptions the browser has revoked. */
async function deliver(rows, payload) {
  if (!rows.length) return;
  await vapid();
  const body = JSON.stringify(payload);
  await Promise.allSettled(rows.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 3600, urgency: 'high' });
      await centralPool.query('UPDATE push_subscriptions SET last_used_at = NOW() WHERE id = ?', [s.id]);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) await removeSubscription(s.endpoint);
      else console.warn('[Push] delivery failed:', err.statusCode || '', err.message);
    }
  }));
}

/**
 * Pushes a socket event to one user's browsers. Never throws.
 * @returns {Promise<number>} how many devices it was sent to
 */
async function pushToUser(userId, unitDb, event, data) {
  try {
    const msg = messageFor(event, data);
    if (!msg || !userId) return 0;
    const [rows] = await centralPool.query(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? AND unit_db = ?', [userId, unitDb || 'central']
    );
    await deliver(rows, msg);
    return rows.length;
  } catch (err) {
    console.warn('[Push] pushToUser failed:', err.message);
    return 0;
  }
}

/** Pushes a socket event to a unit's gate staff (the same people as the socket security room). Never throws. */
async function pushToUnitSecurity(unitId, event, data) {
  try {
    const msg = messageFor(event, data);
    if (!msg || !unitId) return;
    const [[unit]] = await centralPool.query("SELECT db_name FROM units WHERE id = ? AND is_active = 1 LIMIT 1", [unitId]);
    if (!unit) return;
    const [staff] = await getPool(unit.db_name).query(
      "SELECT id FROM users WHERE role_type IN ('security', 'receptionist', 'unit_admin') AND is_active = 1 AND deleted_at IS NULL"
    );
    if (!staff.length) return;
    const [rows] = await centralPool.query(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE unit_db = ? AND user_id IN (?)',
      [unit.db_name, staff.map((s) => s.id)]
    );
    await deliver(rows, msg);
  } catch (err) {
    console.warn('[Push] pushToUnitSecurity failed:', err.message);
  }
}

/**
 * Pushes a message to the visitor portal account that owns this mobile number (last
 * 10 digits; the number must be OTP-verified). Shown even while the portal is open —
 * the portal has no other live alert. Never throws.
 * @param {string} phone
 * @param {{ title: string, body?: string, url?: string, tag?: string }} msg
 * @returns {Promise<number>} how many devices it was sent to
 */
async function pushToVisitorPhone(phone, msg) {
  try {
    const ten = String(phone || '').replace(/\D/g, '').slice(-10);
    if (ten.length !== 10 || !msg?.title) return 0;
    const [rows] = await centralPool.query(
      `SELECT s.id, s.endpoint, s.p256dh, s.auth
       FROM push_subscriptions s
       JOIN visitor_accounts a ON a.id = s.user_id
       WHERE s.unit_db = ? AND a.phone = ? AND a.is_active = 1 AND a.phone_verified_at IS NOT NULL`,
      [VISITOR_SCOPE, ten]
    );
    await deliver(rows, { url: '/public-request', ...msg, audience: 'visitor' });
    return rows.length;
  } catch (err) {
    console.warn('[Push] pushToVisitorPhone failed:', err.message);
    return 0;
  }
}

module.exports = {
  VISITOR_SCOPE, publicKey, saveSubscription, removeSubscription, pushToUser, pushToUnitSecurity, pushToVisitorPhone, messageFor,
};
