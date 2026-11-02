// backend/services/gatePassImage.service.js
'use strict';

/**
 * The gate pass as one picture, sent with the visitor's WhatsApp message: the OHPC
 * logo, the pass QR, the pass number and the visit details. Drawn as SVG and turned
 * into a PNG with sharp, stored in S3 (gate-passes/<pass number>.png) and shared as
 * a signed link Wishper downloads.
 *
 * If the picture can't be made or stored, the plain QR image is sent instead — a
 * missing picture never stops the message.
 */

const fs     = require('fs');
const path   = require('path');
const sharp  = require('sharp');
const QRCode = require('qrcode');
const { centralPool } = require('./dbManager');
const { signQRPayload } = require('../utils/qrToken.util');
const { uploadToS3, getSignedFileUrl } = require('../utils/s3.util');
const { gatePassMediaUrl, isWhatsAppConfigured, visitorPortalUrl } = require('./whatsapp.service');

const LOGO = fs.readFileSync(path.join(__dirname, '../assets/ohpc-logo.svg'));
const MEDIA_LINK_HOURS = 12;   // same as the QR link: queued WhatsApp sends may wait
const WIDTH = 1080;
const NAVY = '#13315c';
const FONT = 'Arial, Helvetica, DejaVu Sans, Liberation Sans, sans-serif';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const xml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** 2026-11-02 / Date → "02 Nov 2026" */
const formatDate = (d) => {
  if (!d) return '';
  const ymd = d instanceof Date
    ? [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    : String(d).slice(0, 10).split('-').map(Number);
  if (ymd.length !== 3 || ymd.some(Number.isNaN)) return String(d);
  return `${String(ymd[2]).padStart(2, '0')} ${MONTHS[ymd[1] - 1]} ${ymd[0]}`;
};
/** "14:30:00" → "2:30 PM" */
const formatTime = (t) => {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};

/** Everything printed on the pass, from the unit DB the pass lives in. */
async function loadPass(db, gatePassId) {
  const [rows] = await db.query(
    `SELECT gp.pass_number, gp.qr_code_data,
            vr.visit_date, vr.visit_start_time, vr.visit_end_time, vr.purpose, vr.unit_id,
            vr.company_name,
            COALESCE(v.full_name, vr.visitor_name, vr.company_name) AS visitor_name,
            h.full_name AS host_name, d.name AS department_name
     FROM gate_passes gp
     JOIN visit_requests vr ON vr.id = gp.visit_request_id
     LEFT JOIN users       h ON h.id = vr.host_user_id
     LEFT JOIN departments d ON d.id = vr.department_id
     LEFT JOIN visitors    v ON v.id = vr.visitor_id
     WHERE gp.id = ? LIMIT 1`,
    [gatePassId]
  );
  if (!rows.length) return null;
  const pass = rows[0];
  // A cross-unit employee visitor isn't on the request row; the pass data names them
  if (!pass.visitor_name) {
    try { pass.visitor_name = JSON.parse(pass.qr_code_data || '{}').visitor_name || null; } catch { /* no name */ }
    if (pass.visitor_name === 'Unknown') pass.visitor_name = null;
  }
  if (pass.unit_id) {
    const [units] = await centralPool.query('SELECT name FROM units WHERE id = ? LIMIT 1', [pass.unit_id]);
    pass.unit_name = units[0]?.name || null;
  }
  return pass;
}

/** The gate pass as a PNG buffer. */
async function renderGatePassPng(pass) {
  const QR = 560;
  const qr = await QRCode.toBuffer(signQRPayload(JSON.parse(pass.qr_code_data)), {
    width: QR, margin: 1, errorCorrectionLevel: 'H', type: 'png',
  });
  const logoW = 760;
  const logo = await sharp(LOGO, { density: 300 }).resize({ width: logoW }).png().toBuffer();
  const logoH = (await sharp(logo).metadata()).height;

  const time = [formatTime(pass.visit_start_time), formatTime(pass.visit_end_time)].filter(Boolean).join(' – ');
  const rows = [
    ['Visitor',    clip(pass.visitor_name, 38)],
    ['Company',    pass.company_name && pass.company_name !== pass.visitor_name ? clip(pass.company_name, 38) : ''],
    ['To meet',    clip(pass.host_name, 38)],
    ['Department', clip(pass.department_name, 38)],
    ['Unit',       clip(pass.unit_name, 38)],
    ['Date',       formatDate(pass.visit_date)],
    ['Time',       time],
    ['Purpose',    clip(pass.purpose, 38)],
  ].filter(([, v]) => v);

  const top = 48;
  const bandY = top + logoH + 36;
  const qrY = bandY + 80 + 44;
  const numY = qrY + QR + 70;
  const rowsY = numY + 64;
  const rowH = 58;
  const footY = rowsY + rows.length * rowH + 30;
  const HEIGHT = footY + 150;
  const portal = visitorPortalUrl();

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <rect x="0" y="0" width="${WIDTH}" height="10" fill="${NAVY}"/>
  <rect x="0" y="${bandY}" width="${WIDTH}" height="80" fill="${NAVY}"/>
  <text x="${WIDTH / 2}" y="${bandY + 53}" text-anchor="middle" font-family="${FONT}" font-size="38" font-weight="700" letter-spacing="6" fill="#ffffff">VISITOR GATE PASS</text>
  <rect x="${(WIDTH - QR) / 2 - 14}" y="${qrY - 14}" width="${QR + 28}" height="${QR + 28}" rx="18" fill="#ffffff" stroke="#d5dce6" stroke-width="2"/>
  <text x="${WIDTH / 2}" y="${numY}" text-anchor="middle" font-family="${FONT}" font-size="46" font-weight="700" letter-spacing="2" fill="${NAVY}">${xml(pass.pass_number)}</text>
  <line x1="80" y1="${rowsY - 8}" x2="${WIDTH - 80}" y2="${rowsY - 8}" stroke="#e3e8ef" stroke-width="2"/>
  ${rows.map(([k, v], i) => `
  <text x="90" y="${rowsY + 42 + i * rowH}" font-family="${FONT}" font-size="30" fill="#5b6b80">${xml(k)}</text>
  <text x="340" y="${rowsY + 42 + i * rowH}" font-family="${FONT}" font-size="32" font-weight="700" fill="#14213d">${xml(v)}</text>`).join('')}
  <rect x="0" y="${footY}" width="${WIDTH}" height="${HEIGHT - footY}" fill="#f2f5f9"/>
  <text x="${WIDTH / 2}" y="${footY + 58}" text-anchor="middle" font-family="${FONT}" font-size="28" font-weight="700" fill="#14213d">Show this pass at the gate. Valid on the visit date only.</text>
  <text x="${WIDTH / 2}" y="${footY + 106}" text-anchor="middle" font-family="${FONT}" font-size="26" fill="#5b6b80">Track your visit: ${xml(portal)}</text>
</svg>`;

  return sharp(Buffer.from(svg))
    .composite([
      { input: logo, left: Math.round((WIDTH - logoW) / 2), top },
      { input: qr,   left: Math.round((WIDTH - QR) / 2),    top: qrY },
    ])
    .png()
    .toBuffer();
}

/**
 * The media link for a gate-pass WhatsApp message: the full gate-pass picture,
 * or the QR image if the picture can't be made. Null when WhatsApp is off.
 *
 * @param {object} db              — the unit pool the pass was issued in
 * @param {{ gate_pass_id?: number, qr_code_path?: string|null }|null} passResult — from generateGatePass
 */
async function gatePassWhatsAppMedia(db, passResult) {
  if (!passResult || !isWhatsAppConfigured()) return null;
  try {
    const pass = passResult.gate_pass_id ? await loadPass(db, passResult.gate_pass_id) : null;
    if (pass?.qr_code_data) {
      const png = await renderGatePassPng(pass);
      const stored = await uploadToS3({ buffer: png, mimeType: 'image/png', folder: 'gate-passes', filename: `${pass.pass_number}.png` });
      const link = await getSignedFileUrl(stored, MEDIA_LINK_HOURS * 60 * 60);
      if (link) return link;
    }
  } catch (err) {
    console.warn('[GatePassImage] sending the QR only — gate-pass picture failed:', err.message);
  }
  return gatePassMediaUrl(passResult.qr_code_path);
}

module.exports = { gatePassWhatsAppMedia, renderGatePassPng, loadPass };
