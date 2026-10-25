// backend/utils/archiveCrypto.util.js
'use strict';

/**
 * Encrypted, compressed archive files for the yearly backup / archival
 * (tender 1.1.10: "backup … handed over … in a secure format").
 *
 * File layout:  "VMSARC1" (7) | salt (16) | iv (12) | AES-256-GCM(gzip(data)) | auth tag (16)
 * Key:          scrypt(passphrase, salt) — the passphrase is never stored.
 * The GCM tag makes any tampering or a wrong passphrase fail loudly on decrypt.
 */

const crypto = require('crypto');
const fs     = require('fs');
const zlib   = require('zlib');
const { pipeline } = require('stream/promises');

const MAGIC       = Buffer.from('VMSARC1');
const HEADER_SIZE = MAGIC.length + 16 + 12;
const TAG_SIZE    = 16;
const SCRYPT_OPTS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const deriveKey = (passphrase, salt) => crypto.scryptSync(passphrase, salt, 32, SCRYPT_OPTS);

/** Throws unless the passphrase is usable for an archive. */
function assertPassphrase(passphrase) {
  if (!passphrase || passphrase.length < 16) {
    throw new Error('ARCHIVE_PASSPHRASE must be set and at least 16 characters long.');
  }
}

/**
 * Compresses + encrypts everything from `readable` into a new file at outPath
 * (fails if it already exists). Returns the file's SHA-256 (hex).
 */
async function encryptStreamToFile(readable, outPath, passphrase) {
  assertPassphrase(passphrase);
  const salt   = crypto.randomBytes(16);
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  const sha256 = crypto.createHash('sha256');

  await pipeline(
    readable,
    zlib.createGzip(),
    cipher,
    async function* frame(source) {
      const header = Buffer.concat([MAGIC, salt, iv]);
      sha256.update(header);
      yield header;
      for await (const chunk of source) { sha256.update(chunk); yield chunk; }
      const tag = cipher.getAuthTag();
      sha256.update(tag);
      yield tag;
    },
    fs.createWriteStream(outPath, { flags: 'wx', mode: 0o600 })
  );
  return sha256.digest('hex');
}

/** Decrypts + decompresses inPath into the writable stream. Throws on a wrong passphrase or tampering. */
async function decryptFileToStream(inPath, writable, passphrase) {
  assertPassphrase(passphrase);
  const { size } = await fs.promises.stat(inPath);
  if (size < HEADER_SIZE + TAG_SIZE) throw new Error('File is too small to be a VMS archive.');

  const fh = await fs.promises.open(inPath, 'r');
  const header = Buffer.alloc(HEADER_SIZE);
  const tag    = Buffer.alloc(TAG_SIZE);
  try {
    await fh.read(header, 0, HEADER_SIZE, 0);
    await fh.read(tag, 0, TAG_SIZE, size - TAG_SIZE);
  } finally {
    await fh.close();
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not a VMS archive file.');

  const salt = header.subarray(MAGIC.length, MAGIC.length + 16);
  const iv   = header.subarray(MAGIC.length + 16, HEADER_SIZE);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  decipher.setAuthTag(tag);

  await pipeline(
    fs.createReadStream(inPath, { start: HEADER_SIZE, end: size - TAG_SIZE - 1 }),
    decipher,
    zlib.createGunzip(),
    writable
  );
}

/** Decrypts a (small) archive fully into a Buffer — used to verify a file right after writing it. */
async function decryptFileToBuffer(inPath, passphrase) {
  const chunks = [];
  const { Writable } = require('stream');
  await decryptFileToStream(inPath, new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
  }), passphrase);
  return Buffer.concat(chunks);
}

module.exports = { encryptStreamToFile, decryptFileToStream, decryptFileToBuffer, assertPassphrase };
