// backend/utils/s3.util.js
'use strict';

/**
 * AWS S3 upload helper.
 *
 * Reads AWS_REGION and AWS_S3_BUCKET from environment variables.
 * Credentials are resolved automatically via the AWS SDK's default
 * credential chain:
 *   1. AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars (local dev / CI)
 *   2. ~/.aws/credentials shared credentials file
 *   3. IAM instance role (on EC2 / ECS / Lambda)
 *
 * Usage:
 *   const { uploadToS3 } = require('../utils/s3.util');
 *   const url = await uploadToS3({
 *     buffer:      file.buffer,
 *     mimeType:    file.mimetype,
 *     folder:      'visitor-photos',    // sub-folder inside the bucket
 *     filename:    'photo-12345.jpg',
 *   });
 */

const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const REGION = process.env.AWS_REGION ;
const BUCKET = process.env.AWS_S3_BUCKET ;

const s3 = new S3Client({ region: REGION });

// The bucket is PRIVATE (visitor photos, gate-pass QRs). The object URL saved in
// the DB is only an identifier; browsers get a short-lived signed link instead.
const SIGNED_URL_TTL_SECONDS = 15 * 60;
const OBJECT_URL_PREFIX = `https://${BUCKET}.s3.${REGION}.amazonaws.com/`;

/**
 * Upload a Buffer to S3 and return the object's URL (stored in the DB as its identifier).
 *
 * @param {object} opts
 * @param {Buffer} opts.buffer    - File content as a Buffer.
 * @param {string} opts.mimeType  - MIME type (e.g. 'image/jpeg').
 * @param {string} opts.folder    - Bucket sub-folder (e.g. 'visitor-photos').
 * @param {string} opts.filename  - Final filename including extension.
 * @returns {Promise<string>}     - S3 object URL (not publicly readable — see getSignedFileUrl).
 */
async function uploadToS3({ buffer, mimeType, folder, filename }) {
  const key = `${folder}/${filename}`;

  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    Body:        buffer,
    ContentType: mimeType,
  }));

  // Standard S3 path-style URL:
  // https://<bucket>.s3.<region>.amazonaws.com/<key>
  return `${OBJECT_URL_PREFIX}${key}`;
}

/**
 * Extracts the S3 key from a stored object URL. Returns null for anything that
 * isn't an object in our bucket (e.g. old pre-S3 local paths "uploads/...").
 */
function keyFromStoredPath(stored) {
  if (!stored || typeof stored !== 'string' || !stored.startsWith(OBJECT_URL_PREFIX)) return null;
  return stored.slice(OBJECT_URL_PREFIX.length) || null;
}

/**
 * Returns a short-lived signed GET link for a stored object URL, or null.
 * Never throws — a missing image is better than failing the whole response.
 *
 * NOTE: links signed with the EC2 instance role also stop working when the role's
 * temporary credentials rotate. That's fine for on-screen use; emails attach the
 * file instead of linking to it (see getFileBuffer).
 */
async function getSignedFileUrl(stored, expiresIn = SIGNED_URL_TTL_SECONDS) {
  const key = keyFromStoredPath(stored);
  if (!key) return null;
  try {
    return await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
  } catch (err) {
    console.error('[S3] Failed to sign URL:', err.message);
    return null;
  }
}

/**
 * Returns copies of rows with the given stored-path fields replaced by signed links.
 * @param {object[]} rows
 * @param {string[]} fields - e.g. ['qr_code_path']
 */
async function withSignedUrls(rows, fields) {
  return Promise.all(rows.map(async (row) => {
    if (!row) return row;
    const out = { ...row };
    for (const field of fields) {
      if (out[field] !== undefined) out[field] = await getSignedFileUrl(out[field]);
    }
    return out;
  }));
}

/** Downloads a stored object into a Buffer (e.g. to attach to an email), or null. */
async function getFileBuffer(stored) {
  const key = keyFromStoredPath(stored);
  if (!key) return null;
  const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return Buffer.from(await obj.Body.transformToByteArray());
}

module.exports = { uploadToS3, getSignedFileUrl, withSignedUrls, getFileBuffer };
