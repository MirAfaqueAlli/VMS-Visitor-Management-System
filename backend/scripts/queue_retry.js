// backend/scripts/queue_retry.js
// Puts FAILED messages back in the queue — e.g. after the mail provider blocked the
// account and has since been unblocked. Only recent ones (default: last 24 hours), so
// nobody gets news about a visit that is long over.
//
//   npm run queue:retry -- EMAIL                         → failed emails, last 24 h
//   npm run queue:retry -- EMAIL "Unusual sending"       → only those whose error says this
//   npm run queue:retry -- WHATSAPP "Invalid API Key" 48 → last 48 h
//   npm run queue:retry -- ALL                           → every channel
//   add --dry-run to only count them
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const { centralPool } = require('../services/dbManager');

const args    = process.argv.slice(2).filter((a) => a !== '--dry-run');
const dryRun  = process.argv.includes('--dry-run');
const channel = String(args[0] || '').toUpperCase();
const match   = args[1] || '';
const hours   = Math.min(24 * 7, Math.max(1, parseInt(args[2], 10) || 24));

if (!['EMAIL', 'SMS', 'WHATSAPP', 'ALL'].includes(channel)) {
  console.log('Usage: npm run queue:retry -- <EMAIL|SMS|WHATSAPP|ALL> ["text in the error"] [hours, default 24] [--dry-run]');
  process.exit(1);
}

(async () => {
  const where = ["status = 'FAILED'", 'created_at >= NOW() - INTERVAL ? HOUR'];
  const params = [hours];
  if (channel !== 'ALL') { where.push('channel = ?'); params.push(channel); }
  if (match) { where.push('last_error LIKE ?'); params.push(`%${match}%`); }
  // Test addresses were skipped on purpose — never re-queue those
  where.push("(last_error IS NULL OR last_error NOT LIKE 'Test address%')");

  const [[{ n }]] = await centralPool.query(`SELECT COUNT(*) AS n FROM message_queue WHERE ${where.join(' AND ')}`, params);
  if (dryRun || !n) {
    console.log(`${n} failed message(s) match${dryRun ? ' (dry run — nothing changed)' : ''}.`);
    process.exit(0);
  }
  const [r] = await centralPool.query(
    `UPDATE message_queue SET status = 'QUEUED', attempts = 0, locked_by = NULL, available_at = NOW(3)
     WHERE ${where.join(' AND ')}`,
    params
  );
  console.log(`${r.affectedRows} message(s) put back in the queue — the running server sends them (paced) within seconds.`);
  process.exit(0);
})().catch((err) => {
  console.error('Could not re-queue:', err.message);
  process.exit(1);
});
