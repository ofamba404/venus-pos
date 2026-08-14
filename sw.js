const CACHE_VERSION = 'venus-pos-v61';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
/** Survives CACHE_VERSION bumps — records that Venus POS was installed as a PWA. */
const META_CACHE = 'venus-pos-meta';
const PWA_INSTALLED_URL = '/__venus_pwa_installed';

const SHELL_URLS = [
  '/',
  '/index.html',
  '/auth.html',
  '/manifest.webmanifest',
  '/pages/inventory.html',
  '/pages/clients.html',
  '/pages/reviews.html',
  '/pages/delivery.html',
  '/pages/history.html',
  '/pages/analytics.html',
  '/pages/admin.html',
  '/css/main.css',
  '/css/auth.css',
  '/assets/logo.svg',
  '/assets/logo-browser.svg',
  '/assets/logo.png',
  '/assets/logo-notif.png',
  '/assets/logo-badge.png',
  '/assets/apple-touch-icon.png',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/js/app.js',
  '/js/bootstrap.js',
  '/js/auth/config.js',
  '/js/auth/gate-boot.js',
  '/js/auth/client.js',
  '/js/auth/gate.js',
  '/js/auth/auth-page.js',
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

/** HTML / CSS / JS must revalidate — cache-first left old UI stuck after deploys. */
function isVolatileShell(pathname) {
  return (
    pathname === '/' ||
    pathname === '/manifest.webmanifest' ||
    pathname.startsWith('/pages/') ||
    pathname.startsWith('/js/') ||
    pathname.startsWith('/css/') ||
    /\.(?:html?|js|css|webmanifest)$/i.test(pathname)
  );
}

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(
    SHELL_URLS.map(async (path) => {
      try {
        const response = await fetch(path, { cache: 'reload' });
        if (response.ok) await cache.put(path, response);
      } catch {
        /* offline / missing — skip */
      }
    }),
  );
}

async function networkFirst(request, cache) {
  try {
    // Bypass HTTP disk cache so week-old CDN copies cannot repopulate SW storage.
    const response = await fetch(request, { cache: 'no-cache' });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = (await cache.match(request)) || (await caches.match(request));
    if (cached) return cached;
    if (request.mode === 'navigate') {
      return (await caches.match('/index.html')) || Response.error();
    }
    return Response.error();
  }
}

async function cacheFirst(request, cache) {
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await caches.match(request)) || Response.error();
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop previous deploy caches only — keep meta + the new version for offline fallback.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== META_CACHE && !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: 'venus-sw-updated', version: CACHE_VERSION });
      }
    })(),
  );
});

async function markPwaInstalled() {
  try {
    const cache = await caches.open(META_CACHE);
    await cache.put(PWA_INSTALLED_URL, new Response('1', { status: 200 }));
  } catch {
    /* ignore */
  }
}

async function isPwaInstalled() {
  try {
    const cache = await caches.open(META_CACHE);
    return Boolean(await cache.match(PWA_INSTALLED_URL));
  } catch {
    return false;
  }
}

/**
 * Ask an open page whether it is running as the installed standalone app.
 * Times out fast so notification clicks stay snappy.
 */
function probeStandalone(client, timeoutMs = 120) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (standalone) => {
      if (settled) return;
      settled = true;
      resolve(Boolean(standalone));
    };
    try {
      const channel = new MessageChannel();
      const timer = setTimeout(() => finish(false), timeoutMs);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        finish(event.data?.standalone);
      };
      client.postMessage({ type: 'venus-display-mode-ping' }, [channel.port2]);
    } catch {
      finish(false);
    }
  });
}

async function focusAndNavigate(client, targetUrl, extra = {}) {
  if ('focus' in client) await client.focus();
  // Load-into-cart must hit the SPA via postMessage — client.navigate would
  // skip the handler and only change the hash.
  if (extra.intent === 'load' && extra.orderId) {
    client.postMessage({
      type: 'venus-notif-click',
      url: targetUrl,
      orderId: extra.orderId,
      intent: 'load',
    });
    return;
  }
  if ('navigate' in client) {
    try {
      await client.navigate(targetUrl);
      return;
    } catch {
      /* uncontrolled / SPA — fall through to postMessage */
    }
  }
  client.postMessage({ type: 'venus-notif-click', url: targetUrl });
}

function orderIdFromNotifData(data = {}) {
  if (data.orderId) return String(data.orderId);
  const tag = String(data.tag || '');
  const fromTag = tag.match(/^storefront-order-(.+)$/);
  if (fromTag?.[1]) return fromTag[1];
  const url = String(data.url || '');
  const fromUrl = url.match(/#load-store-order=([^&]+)/);
  if (fromUrl?.[1]) {
    try {
      return decodeURIComponent(fromUrl[1]);
    } catch {
      return fromUrl[1];
    }
  }
  return '';
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'venus-skip-waiting') {
    self.skipWaiting();
    return;
  }
  if (event.data?.type === 'venus-pwa-installed') {
    event.waitUntil(markPwaInstalled());
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
    caches.open(RUNTIME_CACHE).then((cache) => {
      if (isVolatileShell(url.pathname) || request.mode === 'navigate') {
        return networkFirst(request, cache);
      }
      return cacheFirst(request, cache);
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

  const title = data.title || 'Order placed';
  const targetPath = data.url || '/#store-orders';
  const absoluteUrl = new URL(targetPath, self.registration.scope).href;
  const vibrate = Array.isArray(data.vibrate) ? data.vibrate : [220, 80, 220, 80, 400];

  event.waitUntil(
    (async () => {
      try {
        if (self.navigator?.setAppBadge) await self.navigator.setAppBadge(1);
      } catch {
        /* ignore */
      }
      const notifType = data.type || 'storefront-order';
      const orderId = orderIdFromNotifData({ ...data, url: absoluteUrl });
      const isOrderLoad = notifType === 'storefront-order' && !!orderId;
      const actionLabel =
        notifType === 'store-signup'
          ? 'Open users'
          : notifType === 'store-review'
            ? 'Open reviews'
            : isOrderLoad
              ? 'Load'
              : 'Open orders';
      const notifUrl = isOrderLoad
        ? new URL(`/#load-store-order=${encodeURIComponent(orderId)}`, self.registration.scope).href
        : absoluteUrl;
      await self.registration.showNotification(title, {
        body: data.body || 'Open Venus POS to review the order',
        icon: '/assets/logo-notif.png',
        badge: '/assets/logo-badge.png',
        tag: data.tag || `venus-push-${Date.now()}`,
        renotify: true,
        requireInteraction: data.requireInteraction !== false,
        vibrate,
        silent: false,
        data: {
          type: notifType,
          url: notifUrl,
          tag: data.tag || '',
          ...(orderId ? { orderId, intent: 'load' } : {}),
        },
        actions: [
          { action: isOrderLoad ? 'load' : 'open', title: actionLabel },
          { action: 'dismiss', title: 'Dismiss' },
        ],
      });
    })(),
  );
});

/**
 * Open the installed PWA when possible; only fall back to a normal browser tab
 * when the app is not installed (or openWindow cannot launch it).
 */
self.addEventListener('notificationclick', (event) => {
  const action = event.action;
  event.notification.close();
  if (action === 'dismiss') return;

  const notifData = event.notification.data || {};
  const orderId = orderIdFromNotifData(notifData);
  const wantLoad =
    (action === 'load' || notifData.intent === 'load' || action === '' || action === 'open') &&
    notifData.type === 'storefront-order' &&
    !!orderId;
  const targetUrl =
    notifData.url ||
    (wantLoad
      ? new URL(`/#load-store-order=${encodeURIComponent(orderId)}`, self.registration.scope).href
      : new URL('/#store-orders', self.registration.scope).href);
  const navExtra = wantLoad ? { orderId, intent: 'load' } : {};

  event.waitUntil(
    (async () => {
      try {
        if (self.navigator?.clearAppBadge) await self.navigator.clearAppBadge();
      } catch {
        /* iOS Home Screen only; ignore elsewhere */
      }

      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const focusable = clientList.filter((client) => 'focus' in client);

      // Prefer an already-open standalone / installed-app window.
      const standaloneFlags = await Promise.all(focusable.map((client) => probeStandalone(client)));
      const standaloneIdx = standaloneFlags.findIndex(Boolean);
      if (standaloneIdx >= 0) {
        await focusAndNavigate(focusable[standaloneIdx], targetUrl, navExtra);
        return;
      }

      const installed = await isPwaInstalled();

      // Installed PWA but not running: openWindow launches the standalone app on
      // Chrome Android/Windows — do not steal focus to a plain browser tab first.
      if (installed && self.clients.openWindow) {
        const opened = await self.clients.openWindow(targetUrl);
        if (opened) return;
      }

      // Not installed (or openWindow failed): reuse any open browser tab.
      if (focusable.length) {
        await focusAndNavigate(focusable[0], targetUrl, navExtra);
        return;
      }

      if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
    })(),
  );
});
