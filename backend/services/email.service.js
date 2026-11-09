// backend/services/email.service.js
'use strict';

const fs   = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { getFileBuffer } = require('../utils/s3.util');
const { formatDateTime: displayDateTime, todayIST } = require('../utils/displayFormat.util');

// ── Transporter ──────────────────────────────────────────────────────────────
// Emails are sent by the message queue (services/messageQueue.service), EMAIL_CONCURRENCY
// at a time — so the pool keeps that many SMTP connections open and reuses them.
// Timeouts are bounded so a stuck send can't hold a queue slot for long.
const transporter = nodemailer.createTransport({
  pool: true,
  maxConnections: Math.max(1, parseInt(process.env.EMAIL_CONCURRENCY, 10) || 3),
  maxMessages: 100,
  connectionTimeout: 30_000,
  greetingTimeout: 30_000,
  socketTimeout: 60_000,
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT, 10) || 587,
  secure: parseInt(process.env.SMTP_PORT, 10) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ── OHPC logo, embedded in every email ───────────────────────────────────────
// Mail clients don't show SVG and block remote images by default, so the logo is
// a PNG sent inside the email (cid:) — it shows without "load images".
const LOGO_CID = 'ohpc-logo';
let logoPng = null;
try {
  logoPng = fs.readFileSync(path.join(__dirname, '../assets/ohpc-logo-email.png'));
} catch (err) {
  console.warn('[EmailService] OHPC logo missing — emails go out with the name only:', err.message);
}

/** Plain-text copy of an email (sent alongside the HTML; helps delivery and screen readers). */
const htmlToText = (html) => String(html || '')
  .replace(/<(head|style|title)[^>]*>[\s\S]*?<\/\1>/gi, '')
  .replace(/<span[^>]*display:\s*none[^>]*>[\s\S]*?<\/span>/gi, '')   // inbox preview line
  .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<li[^>]*>/gi, '- ')
  .replace(/<\/(p|tr|h\d|li|table|div)>/gi, '\n')
  .replace(/<\/td>/gi, '   ')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·').replace(/&ndash;/g, '–')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n')
  .trim();

// ── Core send function ───────────────────────────────────────────────────────
/**
 * Sends an email via the configured SMTP transporter.
 * Never throws — all errors are caught and returned as { success: false }.
 * Emails built on the letter layout get the OHPC logo attached inline, and every
 * email gets a plain-text copy.
 *
 * @param {{ to: string, subject: string, html?: string, text?: string, attachments?: object[]|null }} options
 * @returns {Promise<{ success: boolean, error?: string, retryable?: boolean }>}
 */
const sendEmail = async ({ to, subject, html, text, attachments = null }) => {
  try {
    const files = [...(attachments || [])];
    if (logoPng && html?.includes(`cid:${LOGO_CID}`)) {
      files.push({ filename: 'ohpc-logo.png', content: logoPng, contentType: 'image/png', cid: LOGO_CID });
    }
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || `"${process.env.APP_NAME}" <noreply@vms.local>`,
      to,
      subject,
      html,
      text: text || (html ? htmlToText(html) : undefined),
      ...(files.length ? { attachments: files } : {}),
    });
    return { success: true };
  } catch (err) {
    console.error('[EmailService] Failed to send email:', err.message);
    // Connection trouble or an SMTP 4xx ("try again later") is worth another try;
    // a rejected address or a login failure is not
    const temporary = TEMPORARY_SMTP.has(err.code) || (err.responseCode >= 400 && err.responseCode < 500);
    return { success: false, error: err.message, retryable: temporary };
  }
};
const TEMPORARY_SMTP = new Set(['ETIMEDOUT', 'ECONNECTION', 'ECONNRESET', 'ECONNREFUSED', 'ESOCKET', 'EDNS', 'ETLS']);

// ── Gate-pass QR as an inline attachment ─────────────────────────────────────
// The S3 bucket is private, and signed links expire within hours, so the QR is
// embedded in the email itself and referenced as <img src="cid:...">.
const GATE_PASS_QR_CID = 'gatepass-qr';

/**
 * Builds the nodemailer attachment for a gate pass QR stored in S3.
 * Returns null (email goes out without the image) if it can't be fetched.
 *
 * @param {string|null} qrCodePath - gate_passes.qr_code_path
 */
const gatePassQrAttachment = async (qrCodePath) => {
  if (!qrCodePath) return null;
  try {
    const content = await getFileBuffer(qrCodePath);
    return content
      ? { filename: 'gate-pass-qr.png', content, contentType: 'image/png', cid: GATE_PASS_QR_CID }
      : null;
  } catch (err) {
    console.error('[EmailService] Could not load gate pass QR for email:', err.message);
    return null;
  }
};

// ── Letter layout ────────────────────────────────────────────────────────────

/**
 * Escapes user-supplied text before it goes into email HTML, so values typed on
 * the public form (visitor name, purpose, …) can't inject links or markup into
 * company-branded emails.
 */
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const APP      = process.env.APP_NAME || 'OHPC VMS';
const ORG      = 'Odisha Hydro Power Corporation Ltd.';
const appUrl   = (p = '') => `${(process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '')}${p}`;
const subjectOf = (text) => `${text} | ${APP}`;

// Email-safe palette (matches the app: navy brand, hairlines, muted labels)
const C = {
  navy: '#13315c', ink: '#1f2a37', muted: '#5b6b80', line: '#d5dce6', hair: '#e6ebf1',
  soft: '#f6f8fb', page: '#eef1f5', link: '#1a4f8b',
  success: '#0f7b3f', danger: '#b42318', warning: '#8a5a00', neutral: '#475467',
};
const FONT = "Arial, 'Helvetica Neue', Helvetica, sans-serif";
const MONO = "'Courier New', Courier, monospace";

/** Status word as a hairline tag (APPROVED, DECLINED, …). */
const tag = (label, tone = 'neutral') =>
  `<span style="display:inline-block;padding:1px 7px;border:1px solid ${C[tone]};border-radius:3px;color:${C[tone]};font:700 11px/18px ${FONT};letter-spacing:0.6px;">${escapeHtml(label)}</span>`;

const para = (html) => `<p style="margin:0 0 14px;font:14px/1.6 ${FONT};color:${C.ink};">${html}</p>`;

/** Label / value rows in a ruled table; rows with no value are left out. Values are escaped unless { html }. */
const detailsTable = (rows) => {
  const shown = rows.filter((r) => r && r[1] !== null && r[1] !== undefined && r[1] !== '');
  if (!shown.length) return '';
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:4px 0 18px;border:1px solid ${C.line};">
      ${shown.map(([label, value, opts = {}], i) => `
      <tr>
        <td width="36%" valign="top" style="padding:9px 12px;${i < shown.length - 1 ? `border-bottom:1px solid ${C.hair};` : ''}background:${C.soft};font:600 12.5px/1.5 ${FONT};color:${C.muted};">${escapeHtml(label)}</td>
        <td valign="top" style="padding:9px 12px;${i < shown.length - 1 ? `border-bottom:1px solid ${C.hair};` : ''}font:13.5px/1.5 ${opts.mono ? MONO : FONT};color:${C.ink};${opts.bold ? 'font-weight:700;' : ''}">${opts.html ? value : escapeHtml(value)}</td>
      </tr>`).join('')}
    </table>`;
};

/** Solid navy button (a table cell, so Outlook draws it too). */
const button = (href, label) => `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px;">
      <tr><td bgcolor="${C.navy}" style="background:${C.navy};border-radius:3px;">
        <a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 22px;font:700 13.5px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:3px;">${escapeHtml(label)}</a>
      </td></tr>
    </table>`;

/** Numbered instructions under a small heading. */
const instructions = (title, items) => `
    <p style="margin:6px 0 6px;font:700 13px/1.5 ${FONT};color:${C.ink};">${escapeHtml(title)}</p>
    <ol style="margin:0 0 16px 20px;padding:0;font:13px/1.65 ${FONT};color:${C.ink};">
      ${items.map((t) => `<li style="margin:0 0 2px;">${t}</li>`).join('')}
    </ol>`;

/** The gate pass: number and QR in a ruled box with a navy head. */
const gatePassBlock = (passNumber, qrCodeSrc) => !passNumber ? '' : `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:4px 0 20px;border:1px solid ${C.navy};">
      <tr><td bgcolor="${C.navy}" align="center" style="background:${C.navy};padding:8px 16px;font:700 12px/1.4 ${FONT};letter-spacing:2px;color:#ffffff;">VISITOR GATE PASS</td></tr>
      <tr><td align="center" style="padding:18px 16px 16px;">
        <p style="margin:0 0 2px;font:12px/1.5 ${FONT};color:${C.muted};">Gate pass number</p>
        <p style="margin:0 0 14px;font:700 20px/1.3 ${MONO};letter-spacing:1px;color:${C.navy};">${escapeHtml(passNumber)}</p>
        ${qrCodeSrc ? `<img src="${escapeHtml(qrCodeSrc)}" width="170" height="170" alt="Gate pass QR code" style="display:block;margin:0 auto;width:170px;height:170px;border:1px solid ${C.line};" />` : ''}
        <p style="margin:12px 0 0;font:12px/1.5 ${FONT};color:${C.muted};">Show this QR code or the pass number to security at the gate.</p>
      </td></tr>
    </table>`;

const VISITOR_INSTRUCTIONS = [
  'Carry a valid government photo ID (Aadhaar, PAN, Driving Licence or Passport).',
  'Show this gate pass at the security gate. It is valid only on the date of the visit.',
  'Report to the reception and wait for your host to receive you.',
  'Follow the safety and security instructions given at the premises.',
];

/**
 * The OHPC letter: tricolour band, letterhead with the logo, navy title band,
 * reference / date line, the body, a sign-off and the official footer.
 *
 * @param {object} o
 * @param {string} o.title      — e.g. "Visit request approved"
 * @param {string} o.preheader  — inbox preview line
 * @param {string} [o.ref]      — reference shown on the left (e.g. the gate pass number)
 * @param {string} o.body       — HTML (already escaped)
 */
const letter = ({ title, preheader, ref = null, body }) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${C.page};">
  <span style="display:none !important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background:${C.page};">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${C.line};border-collapse:collapse;">
        <!-- Tricolour -->
        <tr><td style="padding:0;font-size:0;line-height:0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="33%" height="4" bgcolor="#FF9933" style="height:4px;background:#FF9933;font-size:0;line-height:0;">&nbsp;</td>
            <td width="34%" height="4" bgcolor="#FFFFFF" style="height:4px;background:#FFFFFF;font-size:0;line-height:0;">&nbsp;</td>
            <td width="33%" height="4" bgcolor="#138808" style="height:4px;background:#138808;font-size:0;line-height:0;">&nbsp;</td>
          </tr></table>
        </td></tr>
        <!-- Letterhead -->
        <tr><td style="padding:20px 28px 18px;border-bottom:1px solid ${C.line};">
          ${logoPng
            ? `<img src="cid:${LOGO_CID}" width="320" alt="${ORG}" style="display:block;width:320px;max-width:100%;height:auto;border:0;" />`
            : `<p style="margin:0;font:700 18px/1.3 ${FONT};color:${C.navy};">${ORG}</p>`}
        </td></tr>
        <!-- Title band -->
        <tr><td bgcolor="${C.navy}" style="background:${C.navy};padding:12px 28px 13px;">
          <p style="margin:0;font:700 10.5px/1.4 ${FONT};letter-spacing:1.6px;color:#a9bad3;text-transform:uppercase;">Visitor Management System</p>
          <p style="margin:3px 0 0;font:700 17px/1.35 ${FONT};color:#ffffff;">${escapeHtml(title)}</p>
        </td></tr>
        <!-- Reference / date -->
        <tr><td style="padding:14px 28px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="font:12px/1.5 ${FONT};color:${C.muted};">${ref ? `Ref: <span style="font-family:${MONO};color:${C.ink};">${escapeHtml(ref)}</span>` : '&nbsp;'}</td>
            <td align="right" style="font:12px/1.5 ${FONT};color:${C.muted};">Date: ${escapeHtml(todayIST())}</td>
          </tr></table>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:18px 28px 4px;">
          ${body}
        </td></tr>
        <!-- Sign-off -->
        <tr><td style="padding:0 28px 24px;font:14px/1.6 ${FONT};color:${C.ink};">
          Regards,<br>
          <strong>Visitor Management System</strong><br>
          ${ORG}
        </td></tr>
        <!-- Footer -->
        <tr><td bgcolor="${C.soft}" style="background:${C.soft};border-top:1px solid ${C.line};padding:14px 28px 16px;font:11.5px/1.65 ${FONT};color:${C.muted};">
          This is a system-generated email from the OHPC Visitor Management System. Please do not reply to this email.<br>
          <strong style="color:${C.ink};">${ORG}</strong> &middot; A Government of Odisha Undertaking<br>
          Corporate Office: Bhoinagar, Janpath, Bhubaneswar, Odisha &ndash; 751022 &middot; CIN U40101OR1995SGC003963<br>
          <a href="https://www.ohpc.co.in" style="color:${C.link};text-decoration:none;">www.ohpc.co.in</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

const greeting = (name) => para(`Dear ${escapeHtml(name || 'Sir / Madam')},`);

// ── Email Templates ──────────────────────────────────────────────────────────

/**
 * General notice on the letter layout — for messages without a template of
 * their own (check-in alerts, cancellations, submissions).
 *
 * @param {object} o
 * @param {string}   o.title
 * @param {string}   [o.name]       — "Dear …"
 * @param {string[]} [o.paragraphs] — HTML (escape user text with escapeHtml)
 * @param {Array}    [o.rows]       — [[label, value], …] for the details table
 * @param {{label: string, tone: string}} [o.status]
 * @param {{href: string, label: string}} [o.cta]
 * @param {string}   [o.ref]
 * @param {string}   [o.preheader]
 * @param {string}   [o.subject]    — defaults to the title
 * @returns {{ subject: string, html: string }}
 */
const noticeTemplate = ({ title, name, paragraphs = [], rows = [], status = null, cta = null, ref = null, preheader = null, subject = null }) => {
  const body = greeting(name)
    + paragraphs.map(para).join('')
    + detailsTable([...rows, ...(status ? [['Status', tag(status.label, status.tone), { html: true }]] : [])])
    + (cta ? button(cta.href, cta.label) : '');
  return { subject: subjectOf(subject || title), html: letter({ title, preheader: preheader || title, ref, body }) };
};

/** noticeTemplate as sendNotification fields: `...noticeMessage({ … })` gives { subject, message }. */
const noticeMessage = (o) => {
  const { subject, html } = noticeTemplate(o);
  return { subject, message: html };
};

/**
 * Template: Visit approval request sent to a host.
 */
const visitRequestTemplate = (visitorName, hostName, visitDate, purpose, orgName, visitTime = null) => {
  const when = displayDateTime(visitDate, visitTime);
  const title = 'Visit request awaiting your approval';
  const body = greeting(hostName)
    + para(`A visit request has been raised to meet you and is <strong>awaiting your approval</strong>. The details are given below.`)
    + detailsTable([
      ['Visitor', visitorName],
      ['Organisation / unit', orgName],
      ['Date and time', when],
      ['Purpose of visit', purpose],
      ['Status', tag('PENDING APPROVAL', 'warning'), { html: true }],
    ])
    + para('Please review the request and approve or decline it in the Visitor Management System, so the visitor can be informed in time.')
    + button(appUrl('/approvals'), 'Review the request');
  return {
    subject: subjectOf(`Visit request from ${visitorName} awaiting your approval`),
    html: letter({ title, preheader: `${visitorName} has requested to meet you on ${when}.`, body }),
  };
};

/**
 * Template: Approval confirmation sent to visitor.
 */
const visitApprovedTemplate = (visitorName, hostName, visitDate, unitName, passNumber = null, qrCodeUrl = null, visitTime = null) => {
  const when = displayDateTime(visitDate, visitTime);
  const title = passNumber ? 'Visit approved – gate pass issued' : 'Visit approved';
  const body = greeting(visitorName)
    + para(`Your visit request has been <strong style="color:${C.success};">approved</strong>. The details of your visit are given below.`)
    + detailsTable([
      ['To meet', hostName],
      ['Unit', unitName],
      ['Date and time', when],
      ['Gate pass number', passNumber, { mono: true, bold: true }],
      ['Status', tag('APPROVED', 'success'), { html: true }],
    ])
    + gatePassBlock(passNumber, qrCodeUrl)
    + instructions('Instructions for the visitor', VISITOR_INSTRUCTIONS)
    + para(`You can see your gate pass and track the status of your visit on the <a href="${escapeHtml(appUrl('/public-request'))}" style="color:${C.link};">OHPC visitor portal</a>.`);
  return {
    subject: subjectOf(passNumber ? `Visit approved – Gate pass ${passNumber}` : 'Your visit request has been approved'),
    html: letter({ title, preheader: `Your visit on ${when} to meet ${hostName} is approved.`, ref: passNumber, body }),
  };
};

/**
 * Template: approval notice to unit staff (the employee who raised the request,
 * the host and the unit admins).
 */
const visitApprovedStaffTemplate = (staffName, visitorName, approverName, visitDate, visitTime = null, passNumber = null, purpose = null) => {
  const when = displayDateTime(visitDate, visitTime);
  const title = 'Visit approved';
  const body = greeting(staffName)
    + para(`The following visit has been <strong style="color:${C.success};">approved</strong> by ${escapeHtml(approverName)}.`)
    + detailsTable([
      ['Visitor', visitorName],
      ['Date and time', when],
      ['Purpose of visit', purpose],
      ['Gate pass number', passNumber, { mono: true, bold: true }],
      ['Approved by', approverName],
      ['Status', tag('APPROVED', 'success'), { html: true }],
    ])
    + button(appUrl('/requests'), 'View in VMS');
  return {
    subject: subjectOf(`Visit approved: ${visitorName} on ${when}`),
    html: letter({ title, preheader: `${visitorName}'s visit on ${when} is approved.`, ref: passNumber, body }),
  };
};

/**
 * Template: Confirmation sent to employee who was hosted as a visitor by another employee.
 */
const employeeHostedVisitTemplate = (visitorName, hostName, visitDate, orgName = '', passNumber = null, qrCodeUrl = null, visitTime = null) => {
  const when = displayDateTime(visitDate, visitTime);
  const title = 'You are invited for a visit';
  const body = greeting(visitorName)
    + para(`<strong>${escapeHtml(hostName)}</strong> has invited you for a visit. The visit is confirmed and your gate pass has been issued.`)
    + detailsTable([
      ['Invited by', hostName],
      ['Unit / location', orgName],
      ['Date and time', when],
      ['Gate pass number', passNumber, { mono: true, bold: true }],
      ['Status', tag('CONFIRMED', 'success'), { html: true }],
    ])
    + gatePassBlock(passNumber, qrCodeUrl)
    + instructions('Instructions for the visitor', VISITOR_INSTRUCTIONS);
  return {
    subject: subjectOf(`${hostName} has invited you for a visit on ${when}`),
    html: letter({ title, preheader: `${hostName} has invited you for a visit on ${when}.`, ref: passNumber, body }),
  };
};

/**
 * Template: Rejection notice sent to visitor.
 */
const visitRejectedTemplate = (visitorName, hostName, visitDate, reason, visitTime = null) => {
  const when = displayDateTime(visitDate, visitTime);
  const title = 'Visit request declined';
  const body = greeting(visitorName)
    + para(`We regret to inform you that your visit request has been <strong style="color:${C.danger};">declined</strong>.`)
    + detailsTable([
      ['To meet', hostName],
      ['Date and time', when],
      ['Reason', reason || 'No reason was given.'],
      ['Status', tag('DECLINED', 'danger'), { html: true }],
    ])
    + para('If you believe this is an error, please contact your host or the reception of the unit. You may submit a fresh request on the visitor portal.');
  return {
    subject: subjectOf('Your visit request has been declined'),
    html: letter({ title, preheader: `Your visit request for ${when} has been declined.`, body }),
  };
};

/**
 * Template: OTP email for public visitor verification.
 */
const otpTemplate = (otp, type = 'phone') => {
  const title = 'Verification code';
  const body = greeting(null)
    + para(`Use the code below to verify your ${type === 'email' ? 'email address' : 'mobile number'} on the OHPC Visitor Management System.`)
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;border:1px solid ${C.navy};border-collapse:collapse;">
        <tr><td style="padding:12px 26px;font:700 28px/1.2 ${MONO};letter-spacing:8px;color:${C.navy};">${escapeHtml(otp)}</td></tr>
      </table>`
    + para('The code is valid for 10 minutes and can be used once. <strong>Do not share it with anyone</strong> — OHPC staff will never ask for it.')
    + para(`If you did not request this code, you can ignore this email.`);
  return {
    subject: subjectOf(`Your verification code is ${otp}`),
    html: letter({ title, preheader: `Your verification code is ${otp}. It is valid for 10 minutes.`, body }),
  };
};

/**
 * Template: visit-day reminder to staff (reminder.service) — the host / requester
 * gets their own visits, a unit admin gets every visit in the unit.
 * @param {Array<{visitor, time, host, pass}>} visits
 */
const staffVisitsTodayTemplate = (staffName, unitName, visits, forAdmin = false) => {
  const n = visits.length;
  const title = 'Visits scheduled today';
  const th = (label) => `<td style="padding:8px 10px;border-bottom:1px solid ${C.line};background:${C.soft};font:700 11px/1.4 ${FONT};letter-spacing:0.5px;text-transform:uppercase;color:${C.muted};">${label}</td>`;
  const td = (value, mono = false) => `<td valign="top" style="padding:8px 10px;border-bottom:1px solid ${C.hair};font:13px/1.45 ${mono ? MONO : FONT};color:${C.ink};">${escapeHtml(value || '—')}</td>`;
  const table = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:4px 0 18px;border:1px solid ${C.line};">
      <tr>${th('Time')}${th('Visitor')}${th('Host')}${th('Gate pass')}</tr>
      ${visits.map((v) => `<tr>${td(v.time ? displayDateTime(null, v.time) : '—')}${td(v.visitor)}${td(v.host)}${td(v.pass, true)}</tr>`).join('')}
    </table>`;
  const body = greeting(staffName)
    + para(forAdmin
      ? `<strong>${n}</strong> approved visit${n === 1 ? ' is' : 's are'} scheduled today at ${escapeHtml(unitName)}.`
      : `You have <strong>${n}</strong> approved visit${n === 1 ? '' : 's'} today.`)
    + table
    + button(appUrl('/requests'), 'View in VMS');
  return {
    subject: subjectOf(`Reminder: ${n} visit${n === 1 ? '' : 's'} today${forAdmin ? ` at ${unitName}` : ''}`),
    html: letter({ title, preheader: `${n} approved visit${n === 1 ? '' : 's'} today.`, body }),
  };
};

/**
 * Template: visit-day reminder to the visitor (reminder.service).
 */
const visitReminderTemplate = (visitorName, hostName, unitName, visitDate, visitTime = null, passNumber = null) => {
  const when = displayDateTime(visitDate, visitTime);
  const title = 'Reminder: your visit today';
  const body = greeting(visitorName)
    + para('This is a reminder of your visit scheduled for today.')
    + detailsTable([
      ['Office', unitName],
      ['To meet', hostName],
      ['Date and time', when],
      ['Gate pass number', passNumber, { mono: true, bold: true }],
    ])
    + instructions('Instructions for the visitor', VISITOR_INSTRUCTIONS);
  return {
    subject: subjectOf('Reminder: your visit today'),
    html: letter({ title, preheader: `Your visit to ${unitName} is today${visitTime ? ` at ${displayDateTime(null, visitTime)}` : ''}.`, ref: passNumber, body }),
  };
};

/**
 * Template: reminder to a host with visit requests still awaiting approval.
 */
const pendingApprovalsReminderTemplate = (hostName, pendingCount) => {
  const n = Number(pendingCount);
  const title = 'Visit requests awaiting your approval';
  const body = greeting(hostName)
    + para(`<strong>${n}</strong> visit request${n === 1 ? '' : 's'} for today or tomorrow ${n === 1 ? 'is' : 'are'} still awaiting your approval. Please approve or decline ${n === 1 ? 'it' : 'them'} so the visitors can be informed in time.`)
    + button(appUrl('/approvals'), 'Review the requests');
  return {
    subject: subjectOf(`${n} visit request${n === 1 ? '' : 's'} awaiting your approval`),
    html: letter({ title, preheader: `${n} visit request${n === 1 ? '' : 's'} awaiting your approval.`, body }),
  };
};

/**
 * Template: password reset link (forgot password).
 */
const passwordResetTemplate = (resetUrl, ttlMinutes) => {
  const title = 'Reset your password';
  const body = greeting(null)
    + para('We received a request to reset the password of your OHPC Visitor Management System account. Use the button below to choose a new password.')
    + button(resetUrl, 'Reset password')
    + para(`The link is valid for ${Number(ttlMinutes)} minutes and can be used once. If you did not ask for a reset, ignore this email — your password will not change.`);
  return {
    subject: subjectOf('Reset your password'),
    html: letter({ title, preheader: `Reset link — valid for ${Number(ttlMinutes)} minutes.`, body }),
  };
};

module.exports = {
  sendEmail,
  escapeHtml,
  noticeTemplate,
  noticeMessage,
  passwordResetTemplate,
  visitReminderTemplate,
  pendingApprovalsReminderTemplate,
  staffVisitsTodayTemplate,
  gatePassQrAttachment,
  GATE_PASS_QR_CID,
  visitRequestTemplate,
  visitApprovedTemplate,
  visitApprovedStaffTemplate,
  employeeHostedVisitTemplate,
  visitRejectedTemplate,
  otpTemplate,
};
