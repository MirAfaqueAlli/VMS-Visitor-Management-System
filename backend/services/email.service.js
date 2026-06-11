// backend/services/email.service.js
'use strict';

const nodemailer = require('nodemailer');

// ── Transporter ──────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT, 10) || 587,
  secure: parseInt(process.env.SMTP_PORT, 10) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ── Core send function ───────────────────────────────────────────────────────
/**
 * Sends an email via the configured SMTP transporter.
 * Never throws — all errors are caught and returned as { success: false }.
 *
 * @param {{ to: string, subject: string, html?: string, text?: string }} options
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
const sendEmail = async ({ to, subject, html, text }) => {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || `"${process.env.APP_NAME}" <noreply@vms.local>`,
      to,
      subject,
      html,
      text,
    });
    return { success: true };
  } catch (err) {
    console.error('[EmailService] Failed to send email:', err.message);
    return { success: false, error: err.message };
  }
};

// ── Email Templates ──────────────────────────────────────────────────────────

const formatDateTime = (d, t) => {
  let dateStr = d;
  if (d instanceof Date) {
    dateStr = d.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
  }
  return t ? `${dateStr} at ${t}` : dateStr;
};

/**
 * Template: Visit approval request sent to a host.
 */
const visitRequestTemplate = (visitorName, hostName, visitDate, purpose, orgName, visitTime = null) => {
  const displayDateTime = formatDateTime(visitDate, visitTime);
  const subject = `[${process.env.APP_NAME || 'VMS'}] New Visit Request from ${visitorName}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9f9f9; border-radius: 8px; overflow: hidden;">
      <div style="background: #1a73e8; padding: 24px 32px;">
        <h1 style="color: #fff; margin: 0; font-size: 20px;">${process.env.APP_NAME || 'Visitor Management System'}</h1>
      </div>
      <div style="padding: 32px; background: #fff;">
        <h2 style="color: #333; margin-top: 0;">New Visit Request</h2>
        <p style="color: #555;">Hello <strong>${hostName}</strong>,</p>
        <p style="color: #555;">You have a new visit request awaiting your approval:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr style="background: #f1f3f4;">
            <td style="padding: 12px; font-weight: bold; color: #333; width: 35%;">Visitor Name</td>
            <td style="padding: 12px; color: #555;">${visitorName}</td>
          </tr>
          <tr>
            <td style="padding: 12px; font-weight: bold; color: #333;">Visit Date & Time</td>
            <td style="padding: 12px; color: #555;">${displayDateTime}</td>
          </tr>
          <tr style="background: #f1f3f4;">
            <td style="padding: 12px; font-weight: bold; color: #333;">Organization</td>
            <td style="padding: 12px; color: #555;">${orgName}</td>
          </tr>
          <tr>
            <td style="padding: 12px; font-weight: bold; color: #333;">Purpose</td>
            <td style="padding: 12px; color: #555;">${purpose}</td>
          </tr>
        </table>
        <p style="color: #555;">Please log in to the <strong>${process.env.APP_NAME || 'VMS'}</strong> portal to approve or reject this request.</p>
        <a href="${process.env.CLIENT_URL || 'http://localhost:5173'}/approvals"
           style="display: inline-block; margin-top: 16px; padding: 12px 28px; background: #1a73e8; color: #fff; text-decoration: none; border-radius: 6px; font-weight: bold;">
          Review Request
        </a>
      </div>
      <div style="padding: 16px 32px; background: #f1f3f4; text-align: center;">
        <p style="color: #999; font-size: 12px; margin: 0;">This is an automated message. Please do not reply directly.</p>
      </div>
    </div>
  `;
  return { subject, html };
};

/**
 * Template: Approval confirmation sent to visitor.
 */
const visitApprovedTemplate = (visitorName, hostName, visitDate, orgName, passNumber = null, qrCodeUrl = null, visitTime = null) => {
  const displayDateTime = formatDateTime(visitDate, visitTime);
  const subject = `[${process.env.APP_NAME || 'VMS'}] Your Visit Request Has Been Approved`;

  const gatePassSection = passNumber ? `
        <div style="margin: 28px 0; padding: 20px; background: #f0faf5; border: 2px solid #0f9d58; border-radius: 8px; text-align: center;">
          <h3 style="color: #0f9d58; margin: 0 0 8px 0;">🎫 Your Gate Pass</h3>
          <p style="font-size: 22px; font-weight: bold; color: #1a1a1a; margin: 0 0 4px 0; letter-spacing: 2px;">${passNumber}</p>
          <p style="color: #555; font-size: 13px; margin: 0 0 16px 0;">Show this code to security at the entrance</p>
          ${qrCodeUrl ? `<img src="${qrCodeUrl}" alt="Gate Pass QR Code" style="width: 160px; height: 160px; display: block; margin: 0 auto;" />` : ''}
        </div>` : '';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9f9f9; border-radius: 8px; overflow: hidden;">
      <div style="background: #0f9d58; padding: 24px 32px;">
        <h1 style="color: #fff; margin: 0; font-size: 20px;">${process.env.APP_NAME || 'Visitor Management System'}</h1>
      </div>
      <div style="padding: 32px; background: #fff;">
        <h2 style="color: #0f9d58; margin-top: 0;">✅ Visit Approved!</h2>
        <p style="color: #555;">Hello <strong>${visitorName}</strong>,</p>
        <p style="color: #555;">Your visit request has been <strong style="color: #0f9d58;">approved</strong>. Here are the details:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr style="background: #f1f3f4;">
            <td style="padding: 12px; font-weight: bold; color: #333; width: 35%;">Host</td>
            <td style="padding: 12px; color: #555;">${hostName}</td>
          </tr>
          <tr>
            <td style="padding: 12px; font-weight: bold; color: #333;">Visit Date & Time</td>
            <td style="padding: 12px; color: #555;">${displayDateTime}</td>
          </tr>
          <tr style="background: #f1f3f4;">
            <td style="padding: 12px; font-weight: bold; color: #333;">Organization</td>
            <td style="padding: 12px; color: #555;">${orgName}</td>
          </tr>
        </table>
        ${gatePassSection}
        <p style="color: #555;">Please carry a valid photo ID when you arrive. Our security team will verify your details at the gate.</p>
      </div>
      <div style="padding: 16px 32px; background: #f1f3f4; text-align: center;">
        <p style="color: #999; font-size: 12px; margin: 0;">This is an automated message. Please do not reply directly.</p>
      </div>
    </div>
  `;
  return { subject, html };
};

/**
 * Template: Rejection notice sent to visitor.
 */
const visitRejectedTemplate = (visitorName, hostName, visitDate, reason, visitTime = null) => {
  const displayDateTime = formatDateTime(visitDate, visitTime);
  const subject = `[${process.env.APP_NAME || 'VMS'}] Your Visit Request Has Been Declined`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9f9f9; border-radius: 8px; overflow: hidden;">
      <div style="background: #d93025; padding: 24px 32px;">
        <h1 style="color: #fff; margin: 0; font-size: 20px;">${process.env.APP_NAME || 'Visitor Management System'}</h1>
      </div>
      <div style="padding: 32px; background: #fff;">
        <h2 style="color: #d93025; margin-top: 0;">❌ Visit Request Declined</h2>
        <p style="color: #555;">Hello <strong>${visitorName}</strong>,</p>
        <p style="color: #555;">We regret to inform you that your visit request has been <strong style="color: #d93025;">declined</strong>.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr style="background: #f1f3f4;">
            <td style="padding: 12px; font-weight: bold; color: #333; width: 35%;">Host</td>
            <td style="padding: 12px; color: #555;">${hostName}</td>
          </tr>
          <tr>
            <td style="padding: 12px; font-weight: bold; color: #333;">Visit Date & Time</td>
            <td style="padding: 12px; color: #555;">${displayDateTime}</td>
          </tr>
          <tr style="background: #f1f3f4;">
            <td style="padding: 12px; font-weight: bold; color: #333;">Reason</td>
            <td style="padding: 12px; color: #d93025;">${reason || 'No reason provided.'}</td>
          </tr>
        </table>
        <p style="color: #555;">If you believe this is an error, please contact the host or the organization's reception desk.</p>
      </div>
      <div style="padding: 16px 32px; background: #f1f3f4; text-align: center;">
        <p style="color: #999; font-size: 12px; margin: 0;">This is an automated message. Please do not reply directly.</p>
      </div>
    </div>
  `;
  return { subject, html };
};

/**
 * Template: OTP email for public visitor verification.
 */
const otpTemplate = (otp, type = 'phone') => {
  const subject = `[${process.env.APP_NAME || 'VMS'}] Your Verification Code`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #f9f9f9; border-radius: 8px; overflow: hidden;">
      <div style="background: #1a73e8; padding: 20px 28px;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">${process.env.APP_NAME || 'Visitor Management System'}</h1>
      </div>
      <div style="padding: 28px; background: #fff; text-align: center;">
        <p style="color: #555; font-size: 14px; margin: 0 0 20px;">Your ${type === 'email' ? 'email' : 'phone'} verification code is:</p>
        <div style="font-size: 36px; font-weight: bold; letter-spacing: 10px; color: #1a73e8; background: #f0f4ff; border-radius: 8px; padding: 18px 24px; display: inline-block; margin-bottom: 20px;">
          ${otp}
        </div>
        <p style="color: #999; font-size: 12px; margin: 0;">This code expires in 10 minutes. Do not share it with anyone.</p>
      </div>
      <div style="padding: 14px 28px; background: #f1f3f4; text-align: center;">
        <p style="color: #999; font-size: 11px; margin: 0;">This is an automated message. Please do not reply directly.</p>
      </div>
    </div>
  `;
  return { subject, html };
};

module.exports = {
  sendEmail,
  visitRequestTemplate,
  visitApprovedTemplate,
  visitRejectedTemplate,
  otpTemplate,
};

