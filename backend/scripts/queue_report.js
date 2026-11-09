// backend/scripts/queue_report.js
// What happened to the latest emails / SMS / WhatsApp messages (vms_central.message_queue):
// status, attempts and the provider's answer when one failed. Recipients are masked.
//
//   npm run queue:report              → last 30 messages
//   npm run queue:report -- 50        → last 50
//   npm run queue:report -- 30 WHATSAPP   → only WhatsApp
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const { centralPool } = require('../services/dbManager');

const limit   = Math.min(500, Math.max(1, parseInt(process.argv[2], 10) || 30));
const channel = ['EMAIL', 'SMS', 'WHATSAPP'].includes(String(process.argv[3]).toUpperCase()) ? String(process.argv[3]).toUpperCase() : null;

const mask = (p) => {
  const to = p?.to || p?.phone || '';
  if (String(to).includes('@')) {
    const [u, d] = String(to).split('@');
    return `${u.slice(0, 2)}***@${d}`;
  }
  const digits = String(to).replace(/\D/g, '');
  return digits ? `******${digits.slice(-4)}` : '—';
};
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) : '');

(async () => {
  const [rows] = await centralPool.query(
    `SELECT id, channel, status, attempts, max_attempts, payload, last_error, created_at, sent_at, available_at
     FROM message_queue ${channel ? 'WHERE channel = ?' : ''} ORDER BY id DESC LIMIT ?`,
    channel ? [channel, limit] : [limit]
  );
  if (!rows.length) {
    console.log('The message queue is empty (sent messages are kept 7 days, failed ones 30).');
    process.exit(0);
  }
  console.table(rows.map((r) => {
    const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload || {};
    return {
      id: r.id,
      channel: r.channel,
      to: mask(p),
      what: r.channel === 'EMAIL' ? String(p.subject || '').slice(0, 40)
        : p.gatePass || p.mediaUrl ? `gate pass picture${p.gatePass?.passNumber ? ` ${p.gatePass.passNumber}` : ''}` : 'message',
      status: r.status,
      attempts: `${r.attempts}/${r.max_attempts}`,
      queued: when(r.created_at),
      sent: when(r.sent_at),
      next_try: r.status === 'QUEUED' && r.attempts ? when(r.available_at) : '',
      error: String(r.last_error || '').slice(0, 90),
    };
  }));
  const [totals] = await centralPool.query('SELECT channel, status, COUNT(*) AS n FROM message_queue GROUP BY channel, status ORDER BY channel, status');
  console.log('Totals:', totals.map((t) => `${t.channel} ${t.status} ${t.n}`).join(' · '));
  process.exit(0);
})().catch((err) => {
  console.error('Could not read the message queue:', err.message);
  process.exit(1);
});
