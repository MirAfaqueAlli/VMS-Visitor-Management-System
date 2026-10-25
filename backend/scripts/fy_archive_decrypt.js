// backend/scripts/fy_archive_decrypt.js
// ──────────────────────────────────────────────────────────────────────────────
// Decrypts a file produced by scripts/fy_archive.js.
//
//   ARCHIVE_PASSPHRASE=... node scripts/fy_archive_decrypt.js <file.enc> [output-file]
//
// *.json.gz.enc  → JSON archive of one database's records for the financial year
// *.sql.gz.enc   → full SQL backup (restore with: mysql -u … < output.sql)
// Without an output path, writes next to the input with the ".gz.enc" suffix removed.
// Fails (and removes the partial output) on a wrong passphrase or a tampered file.
// ──────────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { decryptFileToStream } = require('../utils/archiveCrypto.util');

(async () => {
  const [inPath, outArg] = process.argv.slice(2);
  if (!inPath) {
    console.error('Usage: node scripts/fy_archive_decrypt.js <file.enc> [output-file]');
    process.exit(1);
  }
  const outPath = outArg || inPath.replace(/\.gz\.enc$/, '');
  if (outPath === inPath) {
    console.error('Give an output path (input does not end in .gz.enc).');
    process.exit(1);
  }

  try {
    await decryptFileToStream(inPath, fs.createWriteStream(outPath, { flags: 'wx', mode: 0o600 }), process.env.ARCHIVE_PASSPHRASE);
    console.log(`✔ Decrypted → ${outPath}`);
  } catch (err) {
    try { fs.unlinkSync(outPath); } catch (_) { /* nothing written */ }
    console.error(`✖ ${err.message.includes('authenticate') ? 'Wrong passphrase or the file was modified.' : err.message}`);
    process.exit(1);
  }
})();
