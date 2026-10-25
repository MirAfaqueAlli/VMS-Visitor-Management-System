// backend/scripts/fy_archive.js
// ──────────────────────────────────────────────────────────────────────────────
// Financial-year backup & archival (tender 1.1.10).
//
// "Only the data for the current year shall remain active. At the end of each
//  year a complete database backup shall be taken, after which all transactional
//  records for that financial year shall be archived and removed from the live
//  database. The backup … shall be handed over … in a secure format."
//
// Financial year = 1 April → 31 March (e.g. --fy 2025-26 = 2025-04-01 … 2026-03-31).
//
// Usage (from backend/):
//   node scripts/fy_archive.js --fy 2025-26                       # dry run: counts only, changes nothing
//   node scripts/fy_archive.js --fy 2025-26 --export              # write encrypted archive files only
//   node scripts/fy_archive.js --fy 2025-26 --full-backup         # encrypted mysqldump of all VMS databases
//   node scripts/fy_archive.js --fy 2025-26 --full-backup --purge --confirm
//                                                                 # backup, archive, then REMOVE the FY's records
//   Options: --out <dir> (default: backend/archives)
//            --backup-taken  (with --purge, instead of --full-backup: you already took a
//                             full backup another way, e.g. an RDS snapshot)
//
// Env: ARCHIVE_PASSPHRASE (≥ 16 chars) — encrypts every output file. Keep it safe:
//      without it the files cannot be opened. Decrypt with scripts/fy_archive_decrypt.js.
//
// What is archived/removed per unit DB: visit requests dated in the FY and everything
// hanging off them (companions, approval history, gate passes, visit logs, gate
// rejections, visitor log, notifications), plus that FY's audit_logs and otp_logs.
// Central DB: global_audit_logs (archived) and expired OTP/login/reset rows (removed).
// Master data (users, departments, designations, visitors, debarred list) is kept.
//
// Safety: --purge refuses the current or a future FY, runs per database in one
// transaction, writes + re-reads the encrypted archive before deleting, and rolls
// back if any delete count differs from what was archived.
// ──────────────────────────────────────────────────────────────────────────────
'use strict';

process.env.TZ = 'Asia/Kolkata';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { spawn }    = require('child_process');
const { Readable } = require('stream');
const mysql  = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { encryptStreamToFile, decryptFileToBuffer, assertPassphrase } = require('../utils/archiveCrypto.util');
const { decryptField } = require('../utils/crypto.util');

const DB_CONFIG = {
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '3306', 10),
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
  timezone: '+05:30',
  dateStrings: true,      // archive DATE/DATETIME values exactly as stored
};
const CENTRAL_DB = process.env.DB_CENTRAL_NAME || 'vms_central';

// ── Arguments ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt  = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const FY          = opt('--fy');
const DO_EXPORT   = flag('--export') || flag('--purge');
const DO_PURGE    = flag('--purge');
const DO_BACKUP   = flag('--full-backup');
const OUT_ROOT    = path.resolve(opt('--out') || path.join(__dirname, '../archives'));

const log  = (...m) => console.log(...m);
const fail = (msg) => { console.error(`\n✖ ${msg}\n`); process.exit(1); };

// ── Financial year ────────────────────────────────────────────────────────────
function parseFy(fy) {
  const m = /^(\d{4})-(\d{2})$/.exec(fy || '');
  if (!m || (Number(m[1]) + 1) % 100 !== Number(m[2])) fail('Use --fy YYYY-YY, e.g. --fy 2025-26');
  const startYear = Number(m[1]);
  return {
    label:     `FY${fy}`,
    startYear,
    dateFrom:  `${startYear}-04-01`,
    dateTo:    `${startYear + 1}-03-31`,
    tsFrom:    `${startYear}-04-01 00:00:00`,
    tsTo:      `${startYear + 1}-03-31 23:59:59`,
  };
}

/** Start year of the FY that today (IST) falls in. */
function currentFyStartYear() {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}

// ── What to archive ───────────────────────────────────────────────────────────
// Ordered children-first: this is also the DELETE order (foreign keys).
// Params: 'date' → [dateFrom, dateTo]   'ts' → [tsFrom, tsTo]
const FY_REQUESTS = 'SELECT id FROM visit_requests WHERE visit_date BETWEEN ? AND ?';
const UNIT_TABLES = [
  { table: 'employee_visitor_log', where: `visit_request_id IN (${FY_REQUESTS})`, params: ['date'] },
  { table: 'visit_logs',           where: `visit_request_id IN (${FY_REQUESTS})`, params: ['date'], decrypt: ['id_verified_number'] },
  { table: 'gate_rejections',      where: `visit_request_id IN (${FY_REQUESTS}) OR (visit_request_id IS NULL AND rejected_at BETWEEN ? AND ?)`, params: ['date', 'ts'] },
  { table: 'gate_passes',          where: `visit_request_id IN (${FY_REQUESTS})`, params: ['date'] },
  { table: 'approval_history',     where: `visit_request_id IN (${FY_REQUESTS})`, params: ['date'] },
  { table: 'request_companions',   where: `visit_request_id IN (${FY_REQUESTS})`, params: ['date'], decrypt: ['id_number'] },
  { table: 'notifications',        where: `visit_request_id IN (${FY_REQUESTS}) OR (visit_request_id IS NULL AND created_at BETWEEN ? AND ?)`, params: ['date', 'ts'] },
  { table: 'visit_requests',       where: 'visit_date BETWEEN ? AND ?', params: ['date'] },
  { table: 'audit_logs',           where: 'created_at BETWEEN ? AND ?', params: ['ts'] },
  { table: 'otp_logs',             where: 'created_at BETWEEN ? AND ?', params: ['ts'] },
];
const CENTRAL_TABLES = [
  { table: 'global_audit_logs',     where: 'created_at BETWEEN ? AND ?', params: ['ts'] },
  // Short-lived hashes with no record value: removed, not archived
  { table: 'public_otp_logs',       where: 'created_at <= ?', params: ['tsTo'], purgeOnly: true },
  { table: 'login_otp_sessions',    where: 'created_at <= ?', params: ['tsTo'], purgeOnly: true },
  { table: 'password_reset_tokens', where: 'created_at <= ?', params: ['tsTo'], purgeOnly: true },
];

const paramsFor = (spec, fy) => spec.params.flatMap((p) => ({
  date: [fy.dateFrom, fy.dateTo],
  ts:   [fy.tsFrom, fy.tsTo],
  tsTo: [fy.tsTo],
}[p]));

// ── Full backup (mysqldump) ──────────────────────────────────────────────────
async function fullBackup(dbNames, outDir, passphrase, fy) {
  const file = path.join(outDir, `full-backup-${fy.label}-${new Date().toISOString().replace(/[:.]/g, '-')}.sql.gz.enc`);
  log(`\n▶ Full backup of ${dbNames.length} database(s) → ${path.basename(file)}`);

  const dump = spawn('mysqldump', [
    `--host=${DB_CONFIG.host}`, `--port=${DB_CONFIG.port}`, `--user=${DB_CONFIG.user}`,
    '--single-transaction', '--routines', '--triggers', '--set-gtid-purged=OFF',
    '--databases', ...dbNames,
  ], { env: { ...process.env, MYSQL_PWD: DB_CONFIG.password } });  // password via env, not argv

  let stderr = '';
  dump.stderr.on('data', (d) => { stderr += d; });
  const exited = new Promise((resolve, reject) => {
    dump.on('error', (err) => reject(new Error(`Could not run mysqldump (is it installed and on PATH?): ${err.message}`)));
    dump.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`mysqldump exited with code ${code}: ${stderr.trim()}`))));
  });

  const sha256 = await encryptStreamToFile(dump.stdout, file, passphrase);
  await exited;
  log(`  ✔ ${(fs.statSync(file).size / 1048576).toFixed(1)} MB written`);
  return { file: path.basename(file), sha256, type: 'full-backup', databases: dbNames };
}

// ── Archive (and optionally purge) one database ──────────────────────────────
async function archiveDb(dbName, specs, fy, outDir, passphrase) {
  const conn = await mysql.createConnection({ ...DB_CONFIG, database: dbName });
  await conn.query("SET time_zone = '+05:30'");
  const result = { db: dbName, counts: {}, purged: {} };

  try {
    // Dry run: just count
    if (!DO_EXPORT) {
      for (const spec of specs) {
        const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM ${spec.table} WHERE ${spec.where}`, paramsFor(spec, fy));
        result.counts[spec.table] = Number(n);
      }
      return result;
    }

    if (DO_PURGE) await conn.beginTransaction();

    // 1. Read (and lock, when purging) everything to be archived
    const tables = {};
    for (const spec of specs) {
      if (spec.purgeOnly) continue;
      const lock = DO_PURGE ? ' FOR UPDATE' : '';
      const [rows] = await conn.query(`SELECT * FROM ${spec.table} WHERE ${spec.where}${lock}`, paramsFor(spec, fy));
      // Field-encrypted ID numbers are decrypted so the archive only needs its own passphrase
      for (const col of spec.decrypt || []) for (const r of rows) r[col] = decryptField(r[col]);
      tables[spec.table] = rows;
      result.counts[spec.table] = rows.length;
    }

    // 2. Write the encrypted archive and read it back before anything is deleted
    const file = path.join(outDir, `${dbName}.json.gz.enc`);
    const payload = JSON.stringify({
      meta: { db: dbName, financial_year: fy.label, from: fy.dateFrom, to: fy.dateTo, exported_at: new Date().toISOString(), counts: result.counts },
      tables,
    });
    result.sha256 = await encryptStreamToFile(Readable.from([Buffer.from(payload)]), file, passphrase);
    result.file   = path.basename(file);
    const check = JSON.parse((await decryptFileToBuffer(file, passphrase)).toString('utf8'));
    for (const [t, n] of Object.entries(result.counts)) {
      if ((check.tables[t] || []).length !== n) throw new Error(`Archive verification failed for ${dbName}.${t}`);
    }

    // 3. Purge: delete children-first; every count must match what was archived
    if (DO_PURGE) {
      for (const spec of specs) {
        const [del] = await conn.query(`DELETE FROM ${spec.table} WHERE ${spec.where}`, paramsFor(spec, fy));
        if (!spec.purgeOnly && del.affectedRows !== result.counts[spec.table]) {
          throw new Error(`${dbName}.${spec.table}: deleted ${del.affectedRows} but archived ${result.counts[spec.table]} — rolled back`);
        }
        result.purged[spec.table] = del.affectedRows;
      }
      await conn.commit();
    }
    return result;
  } catch (err) {
    if (DO_PURGE) { try { await conn.rollback(); } catch (_) { /* connection may be gone */ } }
    throw err;
  } finally {
    await conn.end();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const fy = parseFy(FY);
  const passphrase = process.env.ARCHIVE_PASSPHRASE;

  if (DO_PURGE) {
    if (!flag('--confirm')) fail('--purge removes records from the live database. Add --confirm to proceed.');
    if (fy.startYear >= currentFyStartYear()) fail(`${fy.label} is the current or a future financial year — only past years can be purged.`);
    if (!DO_BACKUP && !flag('--backup-taken')) {
      fail('The tender requires a complete backup before records are removed. Add --full-backup (or --backup-taken if you already have one).');
    }
  }
  if (DO_EXPORT || DO_BACKUP) {
    try { assertPassphrase(passphrase); } catch (e) { fail(e.message); }
  }

  // All VMS databases: central + every registered unit DB that exists
  const admin = await mysql.createConnection(DB_CONFIG);
  const [unitRows] = await admin.query(
    `SELECT u.db_name FROM ${mysql.escapeId(CENTRAL_DB)}.units u
     JOIN information_schema.SCHEMATA s ON s.SCHEMA_NAME = u.db_name
     ORDER BY u.db_name`
  );
  await admin.end();
  const unitDbs = unitRows.map((r) => r.db_name);

  log(`\nVMS archival — ${fy.label} (${fy.dateFrom} → ${fy.dateTo})`);
  log(`Mode: ${DO_PURGE ? 'BACKUP + ARCHIVE + PURGE' : DO_EXPORT ? 'archive export' : DO_BACKUP ? 'full backup' : 'dry run (counts only)'}`);
  log(`Databases: ${[CENTRAL_DB, ...unitDbs].join(', ')}`);

  let outDir = null;
  if (DO_EXPORT || DO_BACKUP) {
    outDir = path.join(OUT_ROOT, fy.label);
    fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
    log(`Output: ${outDir}`);
  }

  const manifest = { financial_year: fy.label, from: fy.dateFrom, to: fy.dateTo, created_at: new Date().toISOString(), files: [], databases: [] };

  if (DO_BACKUP) manifest.files.push(await fullBackup([CENTRAL_DB, ...unitDbs], outDir, passphrase, fy));

  const results = [];
  for (const [db, specs] of [[CENTRAL_DB, CENTRAL_TABLES], ...unitDbs.map((d) => [d, UNIT_TABLES])]) {
    log(`\n▶ ${db}`);
    const r = await archiveDb(db, specs, fy, outDir, passphrase);
    for (const [t, n] of Object.entries(r.counts)) log(`  ${t.padEnd(24)} ${String(n).padStart(7)}${r.purged[t] !== undefined ? '  (removed)' : ''}`);
    for (const [t, n] of Object.entries(r.purged)) if (r.counts[t] === undefined) log(`  ${t.padEnd(24)} ${String(n).padStart(7)}  (expired, removed)`);
    if (r.file) manifest.files.push({ file: r.file, sha256: r.sha256, type: 'archive', db, counts: r.counts });
    results.push(r);
  }

  if (outDir) {
    manifest.databases = results.map((r) => ({ db: r.db, archived: r.counts, removed: r.purged }));
    fs.writeFileSync(path.join(outDir, `MANIFEST-${Date.now()}.json`), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  }

  if (DO_PURGE) {
    // Record the archival in the central audit trail (dated today, so it is not itself archived)
    const conn = await mysql.createConnection({ ...DB_CONFIG, database: CENTRAL_DB });
    await conn.query(
      `INSERT INTO global_audit_logs (user_id, source_unit, action, module, record_type, record_id, new_values)
       VALUES (NULL, 'system', 'FY_ARCHIVE', 'SYSTEM', 'FINANCIAL_YEAR', NULL, ?)`,
      [JSON.stringify({ financial_year: fy.label, databases: manifest.databases })]
    );
    await conn.end();
  }

  log(`\n✔ Done.${outDir ? ` Hand over the files in ${outDir} together with the passphrase (sent separately).` : ' Nothing was changed (dry run).'}\n`);
  process.exit(0);
})().catch((err) => fail(err.message));
