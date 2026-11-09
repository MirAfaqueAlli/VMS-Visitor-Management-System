// backend/services/gatePassPdf.service.js
'use strict';

/**
 * The gate pass as a PDF — the same pass security prints from the Gate pass page
 * (frontend/src/components/gate/GatePassCard.jsx, print layout): OHPC letterhead, the
 * visitor's photo (or initials), visitor / host, QR, purpose, validity and the faint OHPC
 * watermark, 190 × 138.5 mm on half an A4 sheet (A5 landscape).
 *
 * Sent to visitors as a WhatsApp document and attached to their approval email. The fonts
 * are embedded (assets/fonts — Liberation Sans), so it reads the same on every device.
 *
 * loadPassRecord() is also what the Gate pass page shows (gatePass.controller.fetchFullPass),
 * so the PDF and the screen always print the same data.
 */

require('../utils/fonts.util');
const fs   = require('fs');
const path = require('path');
const sharp       = require('sharp');
const PDFDocument = require('pdfkit');
const QRCode      = require('qrcode');
const { centralPool } = require('./dbManager');
const { signQRPayload } = require('../utils/qrToken.util');
const { getFileBuffer } = require('../utils/s3.util');
const { visitorOnRecord } = require('./visitorRecord.service');
const { formatDate, formatTime } = require('../utils/displayFormat.util');
const { FONT_DIR } = require('../utils/fonts.util');

// ── The pass record (shared with the Gate pass page) ─────────────────────────

/**
 * Everything printed on a gate pass. Photo and QR are left as stored paths
 * (photo_path, qr_code_path) — the caller signs them for a browser or reads the bytes.
 */
async function loadPassRecord(db, passId) {
  const [rows] = await db.query(
    `SELECT gp.*,
            vr.visit_date, vr.visit_start_time, vr.visit_end_time,
            vr.purpose, vr.status AS request_status, vr.visit_category,
            vr.visitor_name, vr.visitor_phone, vr.company_name,
            vr.unit_id, vr.visitor_id, vr.id_proof_type, vr.id_proof_number, vr.visitor_photo_path AS request_photo_path,
            COALESCE(v.full_name, vr.visitor_name) AS resolved_visitor_name,
            h.full_name  AS host_name,
            d.name       AS department_name
     FROM gate_passes gp
     JOIN visit_requests vr ON vr.id = gp.visit_request_id
     JOIN users           h  ON h.id  = vr.host_user_id
     LEFT JOIN departments d  ON d.id  = vr.department_id
     LEFT JOIN visitors    v  ON v.id  = vr.visitor_id
     WHERE gp.id = ?`,
    [passId]
  );
  if (!rows[0]) return null;
  const row = rows[0];

  // Unit name / code (units live in the central DB)
  let unit_name = null;
  let unit_code = null;
  if (row.unit_id) {
    try {
      const [unitRows] = await centralPool.query('SELECT name, code FROM units WHERE id = ? LIMIT 1', [row.unit_id]);
      if (unitRows[0]) { unit_name = unitRows[0].name; unit_code = unitRows[0].code; }
    } catch (_) { /* non-fatal */ }
  }
  // Fallback: the unit code inside the pass number (e.g. VMS-U1-20261022-97667)
  if (!unit_name && row.pass_number) {
    const match = row.pass_number.match(/^VMS-([A-Za-z0-9_]+)-/);
    if (match) {
      try {
        const [unitRows] = await centralPool.query('SELECT name, code FROM units WHERE code = ? LIMIT 1', [match[1]]);
        if (unitRows[0]) { unit_name = unitRows[0].name; unit_code = unitRows[0].code; }
      } catch (_) { /* non-fatal */ }
    }
  }

  // The visitor's photo: the one taken at this visit's check-in, else the one on record
  const [[thisVisit]] = await db.query(
    'SELECT visitor_photo_path FROM visit_logs WHERE visit_request_id = ? AND visitor_photo_path IS NOT NULL ORDER BY id DESC LIMIT 1',
    [row.visit_request_id]
  );
  const photo_path = thisVisit?.visitor_photo_path || (await visitorOnRecord(db, {
    id: row.visit_request_id, visitor_id: row.visitor_id, visitor_phone: row.visitor_phone,
    id_proof_type: row.id_proof_type, id_proof_number: row.id_proof_number, visitor_photo_path: row.request_photo_path,
  })).photo_path;

  return { ...row, unit_name, unit_code, photo_path };
}

// ── Drawing ──────────────────────────────────────────────────────────────────

const PX = 0.75;              // CSS px → PDF points (the card's sizes are in CSS px)
const MM = 72 / 25.4;         // mm → points
const C = {                   // the app's light theme (index.css)
  ink: '#16202a', ink2: '#3f4852', muted: '#6c747c', line: '#e3e4df', soft: '#f8f8f6', border: '#777777',
};
const SANS = path.join(FONT_DIR, 'LiberationSans-Regular.ttf');
const SANS_BOLD = path.join(FONT_DIR, 'LiberationSans-Bold.ttf');
const LOGO_SVG = fs.readFileSync(path.join(__dirname, '../assets/ohpc-logo.svg'));
const EMBLEM_SVG = fs.readFileSync(path.join(__dirname, '../assets/ohpc-emblem.svg'));

let artwork = null;   // rasterised once: { logo, emblem } PNG buffers
async function loadArtwork() {
  if (!artwork) {
    const [logo, emblem] = await Promise.all([
      sharp(LOGO_SVG, { density: 600 }).resize({ height: 240 }).png().toBuffer(),
      sharp(EMBLEM_SVG, { density: 600 }).resize({ height: 900 }).png().toBuffer(),
    ]);
    artwork = { logo, emblem };
  }
  return artwork;
}

/** Up to two initials for the photo placeholder ("Employ 2" → "E2") — as on the card. */
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/** The pass QR exactly as the app shows it: the stored image, else drawn from the pass data. */
async function qrPng(rec) {
  try {
    const stored = rec.qr_code_path ? await getFileBuffer(rec.qr_code_path) : null;
    if (stored) return stored;
  } catch (err) {
    console.warn('[GatePassPdf] stored QR unavailable — drawing it:', err.message);
  }
  if (!rec.qr_code_data) return null;
  return QRCode.toBuffer(signQRPayload(JSON.parse(rec.qr_code_data)), { width: 600, margin: 1, errorCorrectionLevel: 'H', type: 'png' });
}

/** The visitor's photo as a square JPEG (cover-cropped like object-fit: cover), or null. */
async function photoSquare(photoPath) {
  if (!photoPath) return null;
  try {
    const buf = await getFileBuffer(photoPath);
    return buf ? await sharp(buf).rotate().resize(600, 600, { fit: 'cover' }).jpeg({ quality: 85 }).toBuffer() : null;
  } catch (err) {
    console.warn('[GatePassPdf] photo unavailable — initials instead:', err.message);
    return null;
  }
}

/**
 * The gate pass PDF for a pass.
 * @param {object} db      — the unit pool the pass was issued in
 * @param {number} passId  — gate_passes.id
 * @returns {Promise<{ buffer: Buffer, passNumber: string }|null>}
 */
async function renderGatePassPdf(db, passId) {
  const rec = await loadPassRecord(db, passId);
  if (!rec) return null;
  const [{ logo, emblem }, qr, photo] = await Promise.all([loadArtwork(), qrPng(rec), photoSquare(rec.photo_path)]);

  const doc = new PDFDocument({
    size: 'A5', layout: 'landscape', margin: 0,
    info: { Title: `Gate pass ${rec.pass_number}`, Author: 'Odisha Hydro Power Corporation Ltd.', Subject: 'Visitor gate pass' },
  });
  doc.registerFont('sans', SANS);
  doc.registerFont('bold', SANS_BOLD);
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => { doc.on('end', resolve); doc.on('error', reject); });

  // The card: 190 × 138.5 mm, centred on the half-A4 sheet
  const W = 190 * MM;
  const H = 138.5 * MM;
  const X = (doc.page.width - W) / 2;
  const Y = (doc.page.height - H) / 2;
  const padX = 24 * PX;
  const L = X + padX;
  const R = X + W - padX;

  doc.rect(X, Y, W, H).fill('#ffffff');

  // Watermark: the OHPC emblem, faint, behind everything (78 % of the card's height)
  const wmH = H * 0.78;
  doc.save().opacity(0.06)
    .image(emblem, X, Y + (H - wmH) / 2, { fit: [W, wmH], align: 'center', valign: 'center' })
    .restore();

  // ── Letterhead ──
  const logoH = 34 * PX;
  const headTop = Y + 16 * PX;
  doc.image(logo, L, headTop, { height: logoH });
  const subY = headTop + logoH + 6 * PX;
  const sub = ['GOVERNMENT OF ODISHA', rec.unit_name && rec.unit_name.toUpperCase(), rec.unit_code].filter(Boolean).join(' · ');
  doc.font('bold').fontSize(11 * PX * 0.95).fillColor(C.muted)
    .text(sub, L, subY, { characterSpacing: 0.08 * 11 * PX, lineBreak: false });
  const headContentH = logoH + 6 * PX + 11 * PX * 1.3;
  // Right: "GATE PASS" and the pass number, centred against the left block
  const titleSize = 22 * PX;
  const rightBlockH = titleSize + 6 * PX + 13 * PX;
  const rightTop = headTop + (headContentH - rightBlockH) / 2;
  doc.font('bold').fontSize(titleSize).fillColor(C.ink);
  const title = 'GATE PASS';
  const titleSpacing = 0.14 * titleSize;
  const titleW = doc.widthOfString(title, { characterSpacing: titleSpacing }) - titleSpacing;
  doc.text(title, R - titleW, rightTop, { characterSpacing: titleSpacing, lineBreak: false });
  doc.font('Courier').fontSize(13 * PX).fillColor(C.ink2);
  const numW = doc.widthOfString(rec.pass_number);
  doc.text(rec.pass_number, R - numW, rightTop + titleSize + 6 * PX, { lineBreak: false });
  const headBottom = headTop + headContentH + 16 * PX;
  doc.moveTo(X, headBottom).lineTo(X + W, headBottom).lineWidth(0.75).strokeColor(C.line).stroke();

  // ── Photo · visitor details · QR ──
  const bodyTop = headBottom + 20 * PX;
  const photoS = 38 * MM;
  const radius = 3 * PX;
  doc.roundedRect(L, bodyTop, photoS, photoS, radius).fill(C.soft);
  if (photo) {
    doc.save().roundedRect(L, bodyTop, photoS, photoS, radius).clip().image(photo, L, bodyTop, { width: photoS, height: photoS }).restore();
  } else {
    doc.font('bold').fontSize(40 * PX).fillColor(C.ink2)
      .text(initials(rec.visitor_name || rec.resolved_visitor_name), L, bodyTop + photoS / 2 - 40 * PX * 0.62, { width: photoS, align: 'center', characterSpacing: 1 });
  }
  doc.roundedRect(L, bodyTop, photoS, photoS, radius).lineWidth(0.75).strokeColor(C.line).stroke();

  const qrS = 44 * MM;
  const qrPad = 6 * PX;
  const qrBox = qrS + qrPad * 2;
  const qrX = R - qrBox;
  doc.roundedRect(qrX, bodyTop, qrBox, qrBox, radius).fill('#ffffff');
  if (qr) doc.image(qr, qrX + qrPad, bodyTop + qrPad, { width: qrS, height: qrS });
  else doc.font('sans').fontSize(11 * PX).fillColor(C.muted).text('No QR', qrX, bodyTop + qrBox / 2 - 5, { width: qrBox, align: 'center' });
  doc.roundedRect(qrX, bodyTop, qrBox, qrBox, radius).lineWidth(0.75).strokeColor(C.line).stroke();

  const dX = L + photoS + 20 * PX;
  const dW = qrX - 20 * PX - dX;
  const isEmployee = rec.visit_category === 'EMPLOYEE_VISIT';
  let y = bodyTop;
  doc.font('bold').fontSize(11 * PX).fillColor(C.muted)
    .text(`VISITOR${isEmployee ? ' (EMPLOYEE)' : ''}`, dX, y, { width: dW, characterSpacing: 0.06 * 11 * PX });
  y = doc.y + 2 * PX;
  doc.font('bold').fontSize(21 * PX).fillColor(C.ink)
    .text(rec.visitor_name || rec.resolved_visitor_name || '—', dX, y, { width: dW, lineGap: -1 });
  y = doc.y + 2 * PX;
  if (rec.visitor_phone) {
    doc.font('sans').fontSize(12.5 * PX).fillColor(C.ink2).text(rec.visitor_phone, dX, y, { width: dW });
    y = doc.y;
  }
  if (rec.company_name) {
    doc.font('sans').fontSize(12 * PX).fillColor(C.muted).text(rec.company_name, dX, y, { width: dW });
    y = doc.y;
  }
  y += 12 * PX;
  const labelW = 72 * PX;
  doc.font('sans').fontSize(12.5 * PX).fillColor(C.muted).text('Host', dX, y, { width: labelW });
  doc.font('sans').fontSize(12.5 * PX).fillColor(C.ink)
    .text(rec.host_name || '—', dX + labelW + 12 * PX, y, { width: dW - labelW - 12 * PX, continued: !!rec.department_name });
  if (rec.department_name) doc.fillColor(C.muted).text(` · ${rec.department_name}`);
  const bodyBottom = Math.max(bodyTop + photoS, bodyTop + qrBox, doc.y) + 16 * PX;

  // ── From the bottom: footer line, validity strip, then the purpose fills the rest ──
  const footSize = 11 * PX;
  const footTextY = Y + H - 16 * PX - footSize * 1.25;
  const footRule = footTextY - 12 * PX;
  doc.font('sans').fontSize(footSize).fillColor(C.muted)
    .text('Wear this pass where it can be seen while on the premises · Carry a valid photo ID', L, footTextY, { width: R - L, align: 'center', lineBreak: false });
  doc.moveTo(L, footRule).lineTo(R, footRule).lineWidth(0.75).strokeColor(C.line).stroke();

  const valH = 10 * PX * 2 + 11 * PX * 1.25 + 2 * PX + 13 * PX * 1.3;
  const valY = footRule - 12 * PX - valH;
  doc.roundedRect(L, valY, R - L, valH, radius).fill(C.soft);
  const cols = [
    ['VISIT DATE', formatDate(rec.visit_date) || '—', 'bold'],
    ['FROM', rec.visit_start_time ? formatTime(rec.visit_start_time) : 'Any time', 'bold'],
    ['UNTIL', rec.visit_end_time ? formatTime(rec.visit_end_time) : '—', 'bold'],
    ['VALID', 'On the visit date only', 'bold'],
  ];
  const colGap = 12 * PX;
  const colW = (R - L - 16 * PX * 2 - colGap * 3) / 4;
  cols.forEach(([label, value], i) => {
    const cx = L + 16 * PX + i * (colW + colGap);
    doc.font('bold').fontSize(11 * PX).fillColor(C.muted)
      .text(label, cx, valY + 10 * PX, { width: colW, characterSpacing: 0.06 * 11 * PX, lineBreak: false });
    doc.font('bold').fontSize(13 * PX).fillColor(C.ink)
      .text(value, cx, valY + 10 * PX + 11 * PX * 1.25 + 2 * PX, { width: colW, lineBreak: false, ellipsis: true });
  });

  const purTop = bodyBottom;
  const purBottom = valY - 12 * PX;
  if (purBottom - purTop > 30) {
    doc.roundedRect(L, purTop, R - L, purBottom - purTop, radius).lineWidth(0.75).strokeColor(C.line).stroke();
    doc.font('bold').fontSize(11 * PX).fillColor(C.muted)
      .text('PURPOSE OF VISIT', L + 16 * PX, purTop + 10 * PX, { characterSpacing: 0.06 * 11 * PX, lineBreak: false });
    const textTop = purTop + 10 * PX + 11 * PX * 1.25 + 4 * PX;
    doc.font('sans').fontSize(13 * PX).fillColor(C.ink)
      .text(rec.purpose || '—', L + 16 * PX, textTop, {
        width: R - L - 32 * PX, height: Math.max(10, purBottom - 10 * PX - textTop), ellipsis: true,
      });
  }

  // The card's outline last (on top of the fills)
  doc.rect(X, Y, W, H).lineWidth(0.75).strokeColor(C.border).stroke();

  doc.end();
  await done;
  return { buffer: Buffer.concat(chunks), passNumber: rec.pass_number };
}

/**
 * A link Wishper can download the gate-pass PDF from, to send it as a WhatsApp document:
 * stored in S3 (gate-passes/<pass number>.pdf) and shared as a 12-hour signed link.
 * Null when it can't be made.
 */
async function gatePassPdfUrl(db, passId) {
  const { uploadToS3, getSignedFileUrl } = require('../utils/s3.util');
  const out = await renderGatePassPdf(db, passId);
  if (!out) return null;
  const stored = await uploadToS3({ buffer: out.buffer, mimeType: 'application/pdf', folder: 'gate-passes', filename: `${out.passNumber}.pdf` });
  return getSignedFileUrl(stored, 12 * 60 * 60);
}

module.exports = { loadPassRecord, renderGatePassPdf, gatePassPdfUrl };
