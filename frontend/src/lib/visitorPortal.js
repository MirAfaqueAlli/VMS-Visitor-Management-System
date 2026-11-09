// frontend/src/lib/visitorPortal.js
// Visitor portal session + API client. Separate from the staff client (api/axios.js):
// that one signs staff out and redirects to /login on any 401, which must never
// happen to a visitor. Here a 401 just ends the visitor session.
import axios from "axios";

const KEY = "vms_visitor_session";
export const SESSION_ENDED_EVENT = "vms:visitor-session-ended";

export function getVisitorSession() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
export function setVisitorSession(token) {
  try { localStorage.setItem(KEY, token); } catch { /* private mode */ }
}
export function clearVisitorSession() {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

export const portalApi = axios.create({
  baseURL: `${API_BASE}/visitor-portal`,
  headers: { "Content-Type": "application/json" },
});

/** Plain client for the public endpoints (no staff token, no staff 401 redirect). */
export const publicApi = axios.create({ baseURL: API_BASE, headers: { "Content-Type": "application/json" } });

portalApi.interceptors.request.use((config) => {
  const token = getVisitorSession();
  if (token) config.headers["X-Visitor-Session"] = token;
  return config;
});

portalApi.interceptors.response.use(
  (res) => res,
  (error) => {
    const signedInCall = !!error.config?.headers?.["X-Visitor-Session"];
    if (error.response?.status === 401 && signedInCall) {
      clearVisitorSession();
      window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
    }
    return Promise.reject(error);
  },
);

/** The mobile number a phone_token was issued for (the server still checks the token). */
export function phoneInToken(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part)).phone ?? null;
  } catch {
    return null;
  }
}

/** API error text for a toast. */
export const portalError = (err, fallback) => err?.response?.data?.message || err?.message || fallback;

/** YYYY-MM-DD of a date in the browser's time zone (for comparing visit days). */
export const localDay = (d) => (d ? new Date(d).toLocaleDateString("en-CA") : "");

/** Visits still ahead that the visitor may act on. */
/** Visits still ahead that the visitor may act on — not once they've checked in at the gate. */
export const isUpcoming = (v) =>
  localDay(v.visit_date) >= localDay(new Date()) && ["PENDING", "APPROVED", "SCHEDULED"].includes(v.status)
  && !(v.check_in_at && v.gate_status !== "GATE_REJECTED");
