// backend/services/whatsapp.service.js
'use strict';

/**
 * WhatsApp messages through Wishper (wishper.in). Every SMS notification (approval
 * alerts, approvals / rejections, gate passes, reminders) is also sent on WhatsApp —
 * see notification.service — in the standard layout (whatsappText), and a gate
 * pass message carries the gate-pass picture.
 *
 *   WISHPER_API_KEY   — required; without it WhatsApp is off and nothing is sent
 *   WISHPER_API_URL   — default https://wapi.rextrox.in (Wishper's API host)
 *   WISHPER_SESSION   — optional: session code of the linked WhatsApp number to send from
 *   WISHPER_QUEUE     — default true: Wishper's anti-ban queue (rate-limited delivery)
 *   WHATSAPP_ENABLED  — set to false to switch WhatsApp off without removing the key
 *
 * API: POST {WISHPER_API_URL}/v2/send  { apikey, recipient, text, media?, queue?, session? }
 * (the key also in the x-api-key header). Success: { status: 'success', queue_id }.
 * Errors: 400 missing field, 401 "Invalid API Key" (the key doesn't exist or was
 * deactivated — check it in the Wishper dashboard), 404 no linked WhatsApp number
 * (scan the QR in the Wishper dashboard). Nothing here throws — callers get
 * { success, error? }.
 */

const { getSignedFileUrl } = require('../utils/s3.util');

const API_URL = (process.env.WISHPER_API_URL || 'https://wapi.rextrox.in').replace(/\/+$/, '');
const MEDIA_LINK_HOURS = 12;   // how long Wishper can fetch a gate-pass QR (queued sends may wait)

const isWhatsAppConfigured = () => !!process.env.WISHPER_API_KEY && process.env.WHATSAPP_ENABLED !== 'false';

/** WhatsApp number with country code: a 10-digit Indian number gets 91 in front. */
const toRecipient = (phone) => {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) return `91${d}`;
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`;
  return d;
};

/**
 * @param {string} phone
 * @param {string} text            — message, or the caption when media is sent
 * @param {object} [opts]
 * @param {string} [opts.mediaUrl] — public link to an image / PDF to send with it
 * @returns {Promise<{ success: boolean, messageId?: number, error?: string }>}
 */
async function sendWhatsApp(phone, text, { mediaUrl = null } = {}) {
  if (!isWhatsAppConfigured()) return { success: false, error: 'WhatsApp not configured (WISHPER_API_KEY).' };

  const recipient = toRecipient(phone);
  if (recipient.length < 11 || recipient.length > 15) return { success: false, error: 'Invalid mobile number.' };

  // The key in the body (Wishper's documented way) and in the x-api-key header (also accepted)
  const body = { apikey: process.env.WISHPER_API_KEY, recipient, text, queue: process.env.WISHPER_QUEUE !== 'false' };
  if (mediaUrl) body.media = mediaUrl;
  if (process.env.WISHPER_SESSION) body.session = process.env.WISHPER_SESSION;

  try {
    const res = await fetch(`${API_URL}/v2/send`, {
      method:  'POST',
      // Key in the header (Wishper's recommended way for POST), not the body
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.WISHPER_API_KEY },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !(data.success === true || data.status === 'success')) {
      // Service down (5xx) → try again; a rejected message → don't
      return { success: false, error: `Wishper: ${data.message || data.error || `HTTP ${res.status}`}`, retryable: res.status >= 500 };
    }
    return { success: true, messageId: data.queue_id ?? data.data?.queue_id ?? null };
  } catch (err) {
    // No connection → try again; a timeout isn't (it may already have been taken — no duplicates)
    return { success: false, error: `Wishper request failed: ${err.message}`, retryable: err.name !== 'TimeoutError' };
  }
}

/** A link Wishper can download the gate-pass QR image from (the S3 bucket is private). */
async function gatePassMediaUrl(qrCodePath) {
  if (!qrCodePath || !isWhatsAppConfigured()) return null;
  try {
    return await getSignedFileUrl(qrCodePath, MEDIA_LINK_HOURS * 60 * 60);
  } catch {
    return null;
  }
}

/** A page of the VMS web app (staff screens and the visitor portal). */
const appUrl = (p = '') => `${(process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '')}${p}`;

/** The visitor portal, where visitors sign in to see their passes and track visits. */
const visitorPortalUrl = () => appUrl('/public-request');

/** What every visitor with a gate pass is told (the pass picture is attached). */
const VISITOR_NOTES = [
  'Show your gate pass at the security gate.',
  'Carry a valid government photo ID.',
  'The pass is valid only on the date of the visit.',
];

// WhatsApp formatting characters in a name would bold / italicise the wrong text
const plain = (v) => String(v ?? '').replace(/[*_~`]/g, '').trim();

/**
 * A WhatsApp message in the standard OHPC layout — sender block, bold title,
 * greeting, one-line summary, bold-labelled details, notes, link, footer, with a
 * blank line between blocks:
 *
 *   *Odisha Hydro Power Corporation Ltd.*
 *   Visitor Management System
 *
 *   *VISIT APPROVED*
 *
 *   Dear Bikash Sahoo,
 *   Your visit request has been approved by Sunita Mohanty.
 *
 *   *Gate pass:* VMS-UT2-20261031-89223
 *   *Date:* 31 Oct 2026
 *   *Time:* 9:06 PM
 *
 *   • Show the attached gate pass at the security gate.
 *   • Carry a valid government photo ID.
 *
 *   *Track your visit:*
 *   https://vms.example.in/public-request
 *
 *   _This is an automated message from OHPC VMS. Please do not reply._
 *
 * @param {object} o
 * @param {string}   [o.title]     — shown in capitals
 * @param {string}   [o.name]      — "Dear …,"
 * @param {string}   [o.intro]     — the message in one or two sentences
 * @param {Array}    [o.details]   — [[label, value], …]; empty values are left out
 * @param {string[]} [o.notes]     — bullet points
 * @param {string}   [o.link]
 * @param {string}   [o.linkLabel]
 */
function whatsappText({ title, name, intro, details = [], notes = [], link = null, linkLabel = 'Track your visit' }) {
  const rows = details.filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');
  return [
    '*Odisha Hydro Power Corporation Ltd.*\nVisitor Management System',
    title && `*${plain(title).toUpperCase()}*`,
    [name && `Dear ${plain(name)},`, intro].filter(Boolean).join('\n'),
    rows.map(([k, v]) => `*${k}:* ${plain(v)}`).join('\n'),
    notes.map((n) => `• ${n}`).join('\n'),
    link && `*${linkLabel}:*\n${link}`,
    '_This is an automated message from OHPC VMS. Please do not reply._',
  ].filter(Boolean).join('\n\n');
}

/** The standard layout around an SMS text, for messages without a WhatsApp version of their own. */
const whatsappFromSms = (sms) => whatsappText({
  intro: String(sms || '').replace(/^\s*(?:OHPC\s+)?VMS(\s+reminder)?\s*:\s*/i, (m, reminder) => (reminder ? 'Reminder: ' : '')),
});

module.exports = {
  sendWhatsApp, gatePassMediaUrl, isWhatsAppConfigured, toRecipient,
  appUrl, visitorPortalUrl, whatsappText, whatsappFromSms, VISITOR_NOTES,
};
