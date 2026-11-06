// frontend/src/lib/push.js
// Browser push (system notifications while the app is minimised or closed, and on
// phones): subscribe this browser for the signed-in user, or drop the subscription
// on sign-out. The service worker (public/sw.js) shows what the server pushes.
//
// Two channels, each with its own service-worker registration — and so its own push
// subscription — so one browser can get both without one replacing the other:
//   staff     scope "/"                 /api/push/…                     (subscribePush …)
//   visitors  scope "/public-request"   /api/visitor-portal/me/push/…   (subscribeVisitorPush …)
import apiClient from "../api/axios";
import { portalApi } from "./visitorPortal";

/** Fired on window when this browser's push turns on or off (the settings UI follows it). */
export const PUSH_CHANGE_EVENT = "vms-push-change";
const changed = () => { try { window.dispatchEvent(new Event(PUSH_CHANGE_EVENT)); } catch { /* no window */ } };

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const keyBytes = (base64url) => {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const sameKey = (buffer, base64url) => {
  if (!buffer) return false;
  const a = new Uint8Array(buffer);
  const b = keyBytes(base64url);
  return a.length === b.length && a.every((v, i) => v === b[i]);
};

/** Registers the worker for `scope` and waits (up to 10 s) until it is active — push needs an active worker. */
async function activeRegistration(scope) {
  const reg = await navigator.serviceWorker.register("/sw.js", { scope });
  if (reg.active) return reg;
  const worker = reg.installing || reg.waiting;
  if (worker) {
    await new Promise((resolve) => {
      const done = () => { if (worker.state === "activated" || worker.state === "redundant") resolve(); };
      worker.addEventListener("statechange", done);
      setTimeout(resolve, 10_000);
    });
  }
  return reg;
}

function channel({ scope, flagKey, api, base, label }) {
  let inFlight = null;
  const setFlag = (on) => {
    try { if (on) localStorage.setItem(flagKey, "1"); else localStorage.removeItem(flagKey); } catch { /* storage blocked */ }
    changed();
  };

  /** True while this browser has a working subscription (set after the server saved it). */
  const active = () => {
    try { return localStorage.getItem(flagKey) === "1"; } catch { return false; }
  };

  /**
   * Subscribes this browser and tells the server (needs notification permission).
   * Safe to call often — it reuses the existing subscription. Resolves to true when push is on.
   */
  const subscribe = () => {
    if (!pushSupported() || Notification.permission !== "granted") return Promise.resolve(false);
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const reg = await activeRegistration(scope);
        const { data } = await api.get(`${base}/public-key`);
        const publicKey = data?.data?.public_key;
        if (!publicKey) return false;

        let sub = await reg.pushManager.getSubscription();
        // The server's key changed → the old subscription can't receive anything
        if (sub && !sameKey(sub.options?.applicationServerKey, publicKey)) {
          await sub.unsubscribe().catch(() => {});
          sub = null;
        }
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });

        await api.post(`${base}/subscribe`, { subscription: sub.toJSON() });
        setFlag(true);
        return true;
      } catch (err) {
        // e.g. Brave with "Google services for push messaging" off, or no network to the push service
        console.warn(`[Push] ${label}: not available on this browser:`, err?.message);
        setFlag(false);
        return false;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  /**
   * Stops push for this browser (sign-out): the server forgets it and the browser drops it.
   * @param {object} [headers] — the session header, passed because sign-out clears the session at once
   */
  const unsubscribe = async (headers) => {
    setFlag(false);
    if (!pushSupported()) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration(scope);
      if (!reg || reg.scope !== new URL(scope, window.location.origin).href) return;   // only this channel's own
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;
      await api.post(`${base}/unsubscribe`, { endpoint: sub.endpoint }, headers ? { headers } : undefined).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    } catch { /* nothing to undo */ }
  };

  return { active, subscribe, unsubscribe };
}

/* ── Staff ──────────────────────────────────────────────────────────────── */
const staff = channel({ scope: "/", flagKey: "vms-push-active", api: apiClient, base: "/push", label: "staff" });
export const pushActive    = staff.active;
export const subscribePush = staff.subscribe;
/** @param {string} [token] — the staff session token */
export const unsubscribePush = (token) => staff.unsubscribe(token ? { Authorization: `Bearer ${token}` } : undefined);

/* ── Visitor portal ─────────────────────────────────────────────────────── */
const visitor = channel({ scope: "/public-request", flagKey: "vms-visitor-push-active", api: portalApi, base: "/me/push", label: "visitor portal" });
export const visitorPushActive    = visitor.active;
export const subscribeVisitorPush = visitor.subscribe;
/** @param {string} [session] — the visitor session token */
export const unsubscribeVisitorPush = (session) => visitor.unsubscribe(session ? { "X-Visitor-Session": session } : undefined);

/** Service-worker message the portal listens for to refresh its visits when news arrives. */
export const VISITOR_PUSH_MESSAGE = "vms-visitor-push";
