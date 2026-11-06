// frontend/public/sw.js
// Service Worker — handles background push and notification clicks for VMS

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// ── Handle push events from the server (Web Push API) ─────────────────────
// The server pushes every alert (services/push.service).
//  - Staff: when a VMS window is on screen the app shows it itself (NotificationManager),
//    so it's shown here only when VMS is minimised, in a background tab, closed — or
//    on a locked phone.
//  - Visitors (audience 'visitor', from the visitor portal's own registration): always
//    shown — the portal has no other live alert — and an open portal refreshes its list.
const PORTAL = '/public-request';
const isPortalUrl = (url) => new URL(url, self.location.origin).pathname.startsWith(PORTAL);

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { title: 'OHPC VMS', body: event.data?.text() ?? '' };
  }

  const title   = data.title ?? 'OHPC VMS';
  const options = {
    body:    data.body    ?? '',
    icon:    data.icon    ?? '/icons/icon-192.png',
    badge:   data.badge   ?? '/icons/badge-96.png',
    tag:     data.tag     ?? 'vms-notification',
    data:    { url: data.url || (data.audience === 'visitor' ? PORTAL : '/dashboard') },
    vibrate: [200, 100, 200],
    requireInteraction: data.requireInteraction ?? false,
  };

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (data.audience === 'visitor') {
      windows.filter((w) => isPortalUrl(w.url)).forEach((w) => w.postMessage({ type: 'vms-visitor-push', tag: data.tag }));
      await self.registration.showNotification(title, options);
      return;
    }
    // The open app shows it itself
    if (windows.some((w) => w.visibilityState === 'visible')) return;
    await self.registration.showNotification(title, options);
  })());
});

// ── Notification click → focus or open the app ────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/dashboard';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // A window of the same app already open (staff app or visitor portal) → focus it and navigate
      const portal = isPortalUrl(targetUrl);
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && isPortalUrl(client.url) === portal && 'focus' in client) {
          return client.focus().then((c) => (c && 'navigate' in c ? c.navigate(targetUrl) : null)).catch(() => null);
        }
      }
      // Otherwise open a new tab
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// ── Handle messages from the main thread ─────────────────────────────────
// Allows the app to trigger a notification via sw even when the page is visible
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    self.registration.showNotification(title, options ?? {});
  }
});
