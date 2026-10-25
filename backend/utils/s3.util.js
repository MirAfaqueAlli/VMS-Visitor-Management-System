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

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const REGION = process.env.AWS_REGION ;
const BUCKET = process.env.AWS_S3_BUCKET ;

const s3 = new S3Client({ region: REGION });

/**
 * Upload a Buffer to S3 and return the public HTTPS URL.
 *
 * @param {object} opts
 * @param {Buffer} opts.buffer    - File content as a Buffer.
 * @param {string} opts.mimeType  - MIME type (e.g. 'image/jpeg').
 * @param {string} opts.folder    - Bucket sub-folder (e.g. 'visitor-photos').
 * @param {string} opts.filename  - Final filename including extension.
 * @returns {Promise<string>}     - Public S3 object URL.
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
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
}

module.exports = { uploadToS3 };
