const CACHE_VERSION = 'venus-pos-v17';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/pages/inventory.html',
  '/pages/clients.html',
  '/pages/delivery.html',
  '/pages/history.html',
  '/pages/analytics.html',
  '/css/main.css',
  '/assets/logo.svg',
  '/assets/logo-browser.svg',
  '/assets/logo.png',
  '/assets/logo-badge.png',
  '/assets/apple-touch-icon.png',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/js/app.js',
  '/js/bootstrap.js',
  '/js/pwa.js',
  '/js/notifications.js',
  '/js/store/data-store.js',
  '/js/store/index.js',
  '/js/store/idb.js',
  '/js/store/repository.js',
];

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isStaticAsset(pathname) {
  return (
    pathname === '/' ||
    pathname === '/manifest.webmanifest' ||
    /\.(?:html?|js|css|svg|woff2?|ico|webmanifest|png)$/i.test(pathname) ||
    pathname.startsWith('/js/') ||
    pathname.startsWith('/css/') ||
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/pages/')
  );
}

/** App shell + code — never serve stale after a deploy. */
function isAppCode(pathname, request) {
  if (request.mode === 'navigate') return true;
  if (pathname === '/' || pathname.endsWith('.html')) return true;
  if (pathname.endsWith('.js') || pathname.endsWith('.css') || pathname.endsWith('.webmanifest')) {
    return true;
  }
  if (pathname.startsWith('/js/') || pathname.startsWith('/css/') || pathname.startsWith('/pages/')) {
    return true;
  }
  return false;
}

async function fromCache(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  if (request.mode === 'navigate') {
    return (await caches.match('/index.html')) || Response.error();
  }
  return Response.error();
}

/** Bypass HTTP cache so deploys are visible immediately. */
async function networkThenCache(request, cache, { store = true } = {}) {
  const response = await fetch(request, { cache: 'no-store' });
  if (store && response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Wipe every Cache Storage entry so old deploys cannot linger.
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      // Re-seed a minimal shell for offline navigations.
      try {
        const shell = await caches.open(SHELL_CACHE);
        await shell.addAll(SHELL_URLS);
      } catch {
        /* offline during activate — fine */
      }
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: 'venus-sw-updated', version: CACHE_VERSION });
      }
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'venus-skip-waiting') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isSameOrigin(url)) return;
  if (url.pathname.includes('/rest/v1/')) return;
  if (url.pathname.startsWith('/api/')) return;

  if (!isStaticAsset(url.pathname)) return;

  event.respondWith(
    caches.open(RUNTIME_CACHE).then(async (cache) => {
      // HTML / JS / CSS — network first; cache only as offline fallback.
      if (isAppCode(url.pathname, request)) {
        try {
          return await networkThenCache(request, cache, { store: true });
        } catch {
          return fromCache(request);
        }
      }

      // Images / fonts — still network-first (no stale-while-revalidate).
      try {
        return await networkThenCache(request, cache, { store: true });
      } catch {
        return fromCache(request);
      }
    }),
  );
});

/** Web Push — works when the browser/tab is closed (Android Chrome / installed PWA). */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Venus POS';
  const targetPath = data.url || '/#store-orders';
  const absoluteUrl = new URL(targetPath, self.registration.scope).href;

  event.waitUntil(
    (async () => {
      try {
        if (self.navigator?.setAppBadge) await self.navigator.setAppBadge(1);
      } catch {
        /* ignore */
      }
      await self.registration.showNotification(title, {
        body: data.body || '',
        badge: '/assets/logo-badge.png',
        tag: data.tag || `venus-push-${Date.now()}`,
        renotify: true,
        requireInteraction: data.requireInteraction !== false,
        data: { type: data.type || 'storefront-order', url: absoluteUrl },
      });
    })(),
  );
});

/** Focus an open client or open the URL from notification data. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl =
    event.notification.data?.url || new URL('/#store-orders', self.registration.scope).href;

  event.waitUntil(
    (async () => {
      try {
        if (self.navigator?.clearAppBadge) await self.navigator.clearAppBadge();
      } catch {
        /* iOS Home Screen only; ignore elsewhere */
      }

      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        if (!('focus' in client)) continue;
        await client.focus();
        if ('navigate' in client) {
          try {
            await client.navigate(targetUrl);
          } catch {
            client.postMessage({ type: 'venus-notif-click', url: targetUrl });
          }
        } else {
          client.postMessage({ type: 'venus-notif-click', url: targetUrl });
        }
        return;
      }
      if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
    })(),
  );
});
