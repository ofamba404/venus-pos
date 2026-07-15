const CACHE_VERSION = 'venus-pos-v4';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const SHELL_URLS = [
  '/',
  '/index.html',
  '/pages/inventory.html',
  '/pages/clients.html',
  '/pages/delivery.html',
  '/pages/history.html',
  '/pages/analytics.html',
  '/css/main.css',
  '/assets/logo.svg',
  '/assets/logo.png',
  '/js/app.js',
  '/js/bootstrap.js',
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
    /\.(?:html?|js|css|svg|woff2?|ico)$/i.test(pathname) ||
    pathname.startsWith('/js/') ||
    pathname.startsWith('/css/') ||
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/pages/')
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isSameOrigin(url)) return;
  if (url.pathname.includes('/rest/v1/')) return;

  if (!isStaticAsset(url.pathname)) return;

  event.respondWith(
    caches.open(RUNTIME_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(networkFetch);
        return cached;
      }

      const fresh = await networkFetch;
      if (fresh) return fresh;
      if (request.mode === 'navigate') {
        return (await caches.match('/index.html')) || Response.error();
      }
      return Response.error();
    }),
  );
});

/** Focus an open client or open the URL from notification data. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl =
    event.notification.data?.url || new URL('pages/delivery.html', self.registration.scope).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
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
    }),
  );
});
