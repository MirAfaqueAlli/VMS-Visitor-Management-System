// frontend/src/lib/push.js
// Browser push (system notifications while the app is minimised or closed, and on
// phones): subscribe this browser for the signed-in user, or drop the subscription
// on sign-out. The service worker (public/sw.js) shows what the server pushes.
import apiClient from "../api/axios";

const ACTIVE_KEY = "vms-push-active";

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** True while this browser has a working push subscription (set after the server saved it). */
export const pushActive = () => {
  try { return localStorage.getItem(ACTIVE_KEY) === "1"; } catch { return false; }
};

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

let inFlight = null;

/**
 * Subscribes this browser for push and tells the server (needs notification permission).
 * Safe to call often — it reuses the existing subscription. Resolves to true when push is on.
 */
export function subscribePush() {
  if (!pushSupported() || Notification.permission !== "granted") return Promise.resolve(false);
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const reg = await navigator.serviceWorker.ready;
      const { data } = await apiClient.get("/push/public-key");
      const publicKey = data?.data?.public_key;
      if (!publicKey) return false;

      let sub = await reg.pushManager.getSubscription();
      // The server's key changed → the old subscription can't receive anything
      if (sub && !sameKey(sub.options?.applicationServerKey, publicKey)) {
        await sub.unsubscribe().catch(() => {});
        sub = null;
      }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });

      await apiClient.post("/push/subscribe", { subscription: sub.toJSON() });
      try { localStorage.setItem(ACTIVE_KEY, "1"); } catch { /* storage blocked */ }
      return true;
    } catch (err) {
      // e.g. Brave with "Google services for push messaging" off, or no network to the push service
      console.warn("[Push] Not available on this browser:", err?.message);
      try { localStorage.removeItem(ACTIVE_KEY); } catch { /* storage blocked */ }
      return false;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Stops push for this browser (sign-out): the server forgets it and the browser drops it.
 * @param {string} [token] — the session token, passed because sign-out clears it at once
 */
export async function unsubscribePush(token) {
  try { localStorage.removeItem(ACTIVE_KEY); } catch { /* storage blocked */ }
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await apiClient.post("/push/unsubscribe", { endpoint: sub.endpoint },
      token ? { headers: { Authorization: `Bearer ${token}` } } : undefined).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  } catch { /* nothing to undo */ }
}
