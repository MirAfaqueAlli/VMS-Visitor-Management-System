// backend/services/sms.service.js
'use strict';

/**
 * SMS gateway (tender 1.3: OTPs, visitor notifications, approval alerts, reminders).
 * Provider: Fast2SMS.
 *
 *   FAST2SMS_API_KEY — required. Without it nothing is sent and every call returns
 *                      { success: false, error: 'SMS gateway not configured …' }.
 *
 * OTPs use Fast2SMS's "otp" route, which sends through Fast2SMS's own DLT-registered
 * template ("… is your verification code"), so it needs no template registration.
 * Other messages use the "q" (Quick SMS) route. Under TRAI rules, production
 * transactional SMS in India should use DLT-registered templates (route "dlt") once
 * OHPC's sender ID and templates are approved.
 *
 * Nothing here throws — callers get { success, error? }.
 */

const API_URL = 'https://www.fast2sms.com/dev/bulkV2';

/** Indian mobile number as the gateway expects it: the last 10 digits. */
const toGatewayNumber = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);

const isSmsConfigured = () => !!process.env.FAST2SMS_API_KEY;

async function postToGateway(params) {
  const apiKey = process.env.FAST2SMS_API_KEY;
  if (!apiKey) return { success: false, error: 'SMS gateway not configured (FAST2SMS_API_KEY).' };

  try {
    const res = await fetch(API_URL, {
      method:  'POST',
      headers: { authorization: apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({ flash: '0', ...params }).toString(),
      signal:  AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.return === false) {
      const detail = typeof data.message === 'string' ? data.message : JSON.stringify(data);
      return { success: false, error: `Fast2SMS: ${detail}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: `Fast2SMS request failed: ${err.message}` };
  }
}

/** Sends a numeric OTP through the gateway's OTP route. */
const sendOtpSms = async (phone, otp) => {
  const number = toGatewayNumber(phone);
  if (number.length !== 10) return { success: false, error: 'Invalid mobile number.' };
  return postToGateway({ route: 'otp', variables_values: String(otp), numbers: number });
};

/** Sends a plain-text SMS (notifications, alerts, reminders). */
const sendSms = async (phone, message) => {
  const number = toGatewayNumber(phone);
  if (number.length !== 10) return { success: false, error: 'Invalid mobile number.' };
  return postToGateway({ route: 'q', message, numbers: number });
};

module.exports = { sendOtpSms, sendSms, isSmsConfigured, toGatewayNumber };
