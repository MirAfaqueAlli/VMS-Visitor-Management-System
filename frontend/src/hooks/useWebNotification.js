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
        console.log('[SW] Registered:', reg.scope);
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

    const notifOptions = {
      body,
      icon:    '/favicon.svg',
      badge:   '/favicon.svg',
      tag:     options.tag      ?? 'vms-notification',
      vibrate: options.vibrate  ?? [150, 50, 150],
      data:    options.data     ?? {},
      requireInteraction: options.requireInteraction ?? false,
      silent:  options.silent   ?? false,
      ...options,
    };

    // Prefer SW notification (works in background, shows on mobile)
    if (swRegRef.current) {
      swRegRef.current.showNotification(title, notifOptions).catch(() => {
        // Fallback if SW notification fails
        new Notification(title, notifOptions);
      });
    } else {
      // Direct Notification constructor fallback
      const n = new Notification(title, notifOptions);
      // Auto-close after 8 seconds if no requireInteraction
      if (!notifOptions.requireInteraction) {
        setTimeout(() => n.close(), 8000);
      }
    }
  }, []);

  return { permission, requestPermission, notify };
}
