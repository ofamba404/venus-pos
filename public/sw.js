/**
 * v2 service worker. Served at /next/sw.js, scope /next/ only.
 * The root /sw.js worker is v1 and is not replaced by this file.
 * Push payloads still use v1 paths (/#load-store-order=). This worker
 * opens the same order inside /next/.
 */
const SCOPE_BASE = new URL('./', self.location).pathname;

function orderIdFrom(url) {
  const match = String(url || '').match(/load-store-order=([^&#]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function nextNotificationUrl(data) {
  const orderId = data.orderId || orderIdFrom(data.url);
  if (data.type === 'store-review' || /review/.test(String(data.url || ''))) {
    return `${SCOPE_BASE}reviews`;
  }
  if (orderId) return `${SCOPE_BASE}sell#load-store-order=${encodeURIComponent(orderId)}`;
  return `${SCOPE_BASE}orders`;
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'New order';
  const target = nextNotificationUrl(data);
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || 'Open Venus to see the order',
      icon: `${SCOPE_BASE}assets/logo-notif.png`,
      badge: `${SCOPE_BASE}assets/logo-badge.png`,
      tag: data.tag || `venus-next-${Date.now()}`,
      renotify: true,
      data: { url: target, type: data.type || 'storefront-order' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || `${SCOPE_BASE}orders`, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => client.url.includes(SCOPE_BASE));
      if (open) {
        await open.focus();
        if ('navigate' in open) await open.navigate(target);
        return;
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })(),
  );
});
