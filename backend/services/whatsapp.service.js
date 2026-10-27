// backend/services/whatsapp.service.js
'use strict';

/**
 * WhatsApp messages through Wishper (wishper.in). Every SMS notification (approval
 * alerts, approvals / rejections, gate passes, reminders) is also sent on WhatsApp —
 * see notification.service — and an approval carries the gate-pass QR image.
 *
 *   WISHPER_API_KEY   — required; without it WhatsApp is off and nothing is sent
 *   WISHPER_API_URL   — default https://wapi.rextrox.in (Wishper's API host)
 *   WISHPER_SESSION   — optional: session code of the linked WhatsApp number to send from
 *   WISHPER_QUEUE     — default true: Wishper's anti-ban queue (rate-limited delivery)
 *   WHATSAPP_ENABLED  — set to false to switch WhatsApp off without removing the key
 *
 * API: POST {WISHPER_API_URL}/v2/send  { recipient, text, media?, queue?, session? }
 * with the key in the x-api-key header. Success: { success: true, queue_id }.
 * Errors: 400 missing field, 401 invalid API key, 404 no linked WhatsApp number
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

  const body = { recipient, text, queue: process.env.WISHPER_QUEUE !== 'false' };
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
      return { success: false, error: `Wishper: ${data.message || data.error || `HTTP ${res.status}`}` };
    }
    return { success: true, messageId: data.queue_id ?? data.data?.queue_id ?? null };
  } catch (err) {
    return { success: false, error: `Wishper request failed: ${err.message}` };
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

module.exports = { sendWhatsApp, gatePassMediaUrl, isWhatsAppConfigured, toRecipient };
