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

// Keep in step with src/domain/push-target.ts (tests/unit/sw-push.test.ts runs this file against it).
function nextNotificationUrl(data) {
  const orderId = data.orderId || orderIdFrom(data.url);
  if (data.type === 'test') return `${SCOPE_BASE}settings`;
  if (data.type === 'store-review' || /review/.test(String(data.url || ''))) {
    return `${SCOPE_BASE}reviews`;
  }
  if (orderId) return `${SCOPE_BASE}orders#order=${encodeURIComponent(orderId)}`;
  return `${SCOPE_BASE}orders`;
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = (event.data ? event.data.json() : {}) || {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'New order';
  const isOrder = !data.type || data.type === 'storefront-order';
  const target = nextNotificationUrl(data);
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || 'Open Venus to see the order',
      icon: `${SCOPE_BASE}notif/venus-notif-icon-r2-192.png`,
      badge: `${SCOPE_BASE}notif/venus-notif-badge-r2-96.png`,
      tag: data.tag || `venus-next-${Date.now()}`,
      renotify: true,
      requireInteraction: data.requireInteraction !== false && data.type !== 'test',
      vibrate: Array.isArray(data.vibrate) ? data.vibrate : isOrder ? [220, 80, 220, 80, 400] : [200],
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
