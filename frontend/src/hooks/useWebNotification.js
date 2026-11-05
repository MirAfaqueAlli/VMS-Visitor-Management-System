// frontend/src/hooks/useWebNotification.js
/**
 * useWebNotification
 *
 * Manages:
 *  1. Service Worker registration
 *  2. Notification permission state
 *  3. `notify(title, body, options)` — fires an OS-level notification
 *
 * The notification is always fired via the Service Worker (if available) so
 * it works even when the browser tab is minimised or in the background.
 * Falls back to the Notification constructor if SW is not ready yet.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { pushActive } from '../lib/push';

export default function useWebNotification() {
  const [permission, setPermission] = useState(
    () => ('Notification' in window ? Notification.permission : 'unsupported')
  );
  const swRegRef = useRef(null);

  // ── Sync permission state live (handles browser settings changes) ─────────
  useEffect(() => {
    if (!('permissions' in navigator)) return;
    let permStatus;
    navigator.permissions.query({ name: 'notifications' }).then((status) => {
      permStatus = status;
      setPermission(status.state === 'prompt' ? 'default' : status.state);
      status.onchange = () => {
        setPermission(status.state === 'prompt' ? 'default' : status.state);
      };
    }).catch(() => {});
    return () => {
      if (permStatus) permStatus.onchange = null;
    };
  }, []);

  // ── Register Service Worker ──────────────────────────────────────────────
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        swRegRef.current = reg;
      })
      .catch((err) => {
        console.warn('[SW] Registration failed:', err.message);
      });
  }, []);

  // ── Request permission ───────────────────────────────────────────────────
  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted') {
      setPermission('granted');
      return 'granted';
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, []);

  // ── Fire a native notification ───────────────────────────────────────────
  const notify = useCallback((title, body, options = {}) => {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    // Tab in the background with push on: the server's push shows it (same tag) — don't show it twice
    if (document.visibilityState === 'hidden' && pushActive()) return;

    const notifOptions = {
      body,
      icon:    '/icons/icon-192.png',
      badge:   '/icons/badge-96.png',   // Android shows the badge as a white silhouette
      tag:     options.tag      ?? 'vms-notification',
      vibrate: options.vibrate  ?? [150, 50, 150],
      data:    options.data     ?? {},
      requireInteraction: options.requireInteraction ?? false,
      silent:  options.silent   ?? false,
      ...options,
    };

    const direct = () => {
      // Desktop only — Android's Chrome has no Notification constructor (it throws)
      try {
        const n = new Notification(title, notifOptions);
        if (!notifOptions.requireInteraction) setTimeout(() => n.close(), 8000);
      } catch { /* no other way to show it */ }
    };

    // Prefer the service worker (works in the background and on phones)
    const reg = swRegRef.current;
    if (reg) {
      reg.showNotification(title, notifOptions).catch(direct);
    } else if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then((r) => r.showNotification(title, notifOptions))
        .catch(direct);
    } else {
      direct();
    }
  }, []);

  return { permission, requestPermission, notify };
}
