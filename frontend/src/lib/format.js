// frontend/src/lib/format.js
// Data formats (DESIGN_RULES §16): en-IN numbers, "24 Oct 2026" dates,
// "24 Oct, 13:22" date-times (24h), "4d ago" relative times, "—" for empty.

export const DASH = '—';

const toDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** 1,00,000 */
export const fmtNumber = (n) => (n === null || n === undefined || n === '' ? DASH : Number(n).toLocaleString('en-IN'));

/** 24 Oct 2026 */
export const fmtDate = (v) => {
  const d = toDate(v);
  return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : DASH;
};

/** 24 Oct, 13:22 */
export const fmtDateTime = (v) => {
  const d = toDate(v);
  if (!d) return DASH;
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date}, ${time}`;
};

/** "13:22" — time of day from a date-time (24h) */
export const fmtClock = (v) => {
  const d = toDate(v);
  return d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : DASH;
};

/** "13:22" from a TIME column ("13:22:00") */
export const fmtTime = (t) => (t ? String(t).slice(0, 5) : DASH);

/** now · 5m ago · 3h ago · 4d ago · then the date */
export const relTime = (v) => {
  const d = toDate(v);
  if (!d) return DASH;
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(d);
};

/** Value or "—" */
export const orDash = (v) => (v === null || v === undefined || v === '' ? DASH : v);

/** Up to two initials for an avatar tile */
export const initials = (name) =>
  String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

/** Export file name: what + when, e.g. visit-requests_20261027-2045 */
export const exportName = (what) => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${what}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};
