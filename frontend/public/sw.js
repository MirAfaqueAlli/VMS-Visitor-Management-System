// frontend/public/sw.js
// Service Worker — handles background push and notification clicks for VMS

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// ── Handle push events from the server (Web Push API) ─────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { title: 'VMS Notification', body: event.data?.text() ?? '' };
  }

  const title   = data.title ?? 'VMS — Visitor Management';
  const options = {
    body:    data.body    ?? '',
    icon:    data.icon    ?? '/favicon.svg',
    badge:   data.badge   ?? '/favicon.svg',
    tag:     data.tag     ?? 'vms-notification',
    data:    data.url     ? { url: data.url } : {},
    vibrate: [200, 100, 200],
    requireInteraction: data.requireInteraction ?? false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click → focus or open the app ────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/dashboard';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a VMS window is already open, focus it and navigate
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.navigate(targetUrl);
          return;
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
