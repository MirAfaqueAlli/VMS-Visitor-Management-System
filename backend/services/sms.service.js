// backend/services/sms.service.js
'use strict';

/**
 * SMS gateway (tender 1.3: OTPs, visitor notifications, approval alerts, reminders).
 * Provider: iCloudSMS (msg.icloudsms.com).
 *
 *   ICLOUDSMS_AUTH_KEY   — account auth key        } all three required; without them
 *   ICLOUDSMS_SENDER_ID  — DLT sender ID (e.g. STPL) } nothing is sent and every call returns
 *   ICLOUDSMS_ROUTE_ID   — route from the panel      } { success: false, error: '… not configured' }
 *
 * The gateway answers HTTP 200 with { responseCode, response }: "3001" means the
 * message was accepted (response = message id); anything else is an error
 * (e.g. "3009" Unauthorized). Accepted is not delivered: Indian operators drop
 * texts that don't match a DLT-registered template for the sender ID — check the
 * iCloudSMS delivery report if accepted messages don't arrive.
 *
 * Nothing here throws — callers get { success, error? }.
 */

const API_URL     = 'https://msg.icloudsms.com/rest/services/sendSMS/sendGroupSms';
const ACCEPTED    = '3001';

/** Indian mobile number as the gateway expects it: the last 10 digits. */
const toGatewayNumber = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);

const isSmsConfigured = () =>
  !!(process.env.ICLOUDSMS_AUTH_KEY && process.env.ICLOUDSMS_SENDER_ID && process.env.ICLOUDSMS_ROUTE_ID);

async function postToGateway(number, message) {
  if (!isSmsConfigured()) {
    return { success: false, error: 'SMS gateway not configured (ICLOUDSMS_AUTH_KEY / ICLOUDSMS_SENDER_ID / ICLOUDSMS_ROUTE_ID).' };
  }

  const query = new URLSearchParams({
    AUTH_KEY:       process.env.ICLOUDSMS_AUTH_KEY,
    message,
    senderId:       process.env.ICLOUDSMS_SENDER_ID,
    routeId:        process.env.ICLOUDSMS_ROUTE_ID,
    mobileNos:      number,
    smsContentType: 'english',
  });
  try {
    // The URL carries the auth key — never log it
    const res  = await fetch(`${API_URL}?${query}`, { signal: AbortSignal.timeout(10_000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || String(data.responseCode) !== ACCEPTED) {
      return { success: false, error: `iCloudSMS: ${data.response || `HTTP ${res.status}`} (code ${data.responseCode ?? 'none'})` };
    }
    return { success: true, messageId: data.response };
  } catch (err) {
    return { success: false, error: `iCloudSMS request failed: ${err.message}` };
  }
}

/** Sends a numeric OTP (wording of the sender's existing DLT OTP template). */
const sendOtpSms = async (phone, otp) => {
  const number = toGatewayNumber(phone);
  if (number.length !== 10) return { success: false, error: 'Invalid mobile number.' };
  return postToGateway(number, `Your OTP for login is ${otp} . STPL`);
};

/** Sends a plain-text SMS (notifications, alerts, reminders). */
const sendSms = async (phone, message) => {
  const number = toGatewayNumber(phone);
  if (number.length !== 10) return { success: false, error: 'Invalid mobile number.' };
  return postToGateway(number, message);
};

module.exports = { sendOtpSms, sendSms, isSmsConfigured, toGatewayNumber };
