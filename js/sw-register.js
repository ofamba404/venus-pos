function serviceWorkerPath() {
  return /\/pages(?:\/|$)/.test(location.pathname) ? '../sw.js' : 'sw.js';
}

/**
 * Register shell service worker with aggressive update reloads so deploys
 * show up without a manual cache clear.
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  // Reload once when an *update* takes control (not on first install).
  let hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  const reloadForUpdate = () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  };

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    reloadForUpdate();
    hadController = true;
  });

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'venus-sw-updated') reloadForUpdate();
  });

  const register = () => {
    const url = new URL(serviceWorkerPath(), location.href).href;
    navigator.serviceWorker
      .register(url, { updateViaCache: 'none' })
      .then((reg) => {
        const nudgeWaiting = () => {
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'venus-skip-waiting' });
          }
        };
        const pingUpdate = () => {
          try {
            void reg.update().then(nudgeWaiting);
          } catch {
            /* ignore */
          }
        };

        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed') nudgeWaiting();
          });
        });

        // One-time wipe of Cache Storage so browsers stuck on an old shell recover
        // after this deploy (does not unregister — preserves Web Push).
        const PURGE_KEY = 'venus-sw-purge-v21';
        if (!localStorage.getItem(PURGE_KEY)) {
          localStorage.setItem(PURGE_KEY, '1');
          void caches.keys().then(async (keys) => {
            await Promise.all(keys.map((k) => caches.delete(k)));
            location.reload();
          });
          return;
        }

        pingUpdate();
        nudgeWaiting();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') pingUpdate();
        });
        window.addEventListener('focus', pingUpdate);
        // Check for a new deploy while the tab stays open.
        setInterval(pingUpdate, 60_000);
      })
      .catch((err) => console.warn('SW registration failed', err));
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
