// backend/utils/displayFormat.util.js
'use strict';

/**
 * Dates and times as people read them in emails, WhatsApp messages and the
 * gate-pass picture: "31 Oct 2026", "2:30 PM", "31 Oct 2026, 2:30 PM".
 * mysql2 returns DATE columns as Date objects and the API takes "YYYY-MM-DD"
 * strings — both work.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2026-11-02 / Date → "02 Nov 2026" ('' when there's no date). */
const formatDate = (d) => {
  if (!d) return '';
  const ymd = d instanceof Date
    ? [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    : String(d).slice(0, 10).split('-').map(Number);
  if (ymd.length !== 3 || ymd.some(Number.isNaN) || !MONTHS[ymd[1] - 1]) return String(d);
  return `${String(ymd[2]).padStart(2, '0')} ${MONTHS[ymd[1] - 1]} ${ymd[0]}`;
};

/** "14:30:00" → "2:30 PM" ('' when there's no time). */
const formatTime = (t) => {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};

/** "02 Nov 2026, 2:30 PM" — either part may be missing. */
const formatDateTime = (d, t) => [formatDate(d), formatTime(t)].filter(Boolean).join(', ');

/** Today in India, for letter dates: "03 Nov 2026". */
const todayIST = () => new Date().toLocaleDateString('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
});

module.exports = { formatDate, formatTime, formatDateTime, todayIST };
