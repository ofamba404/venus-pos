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
