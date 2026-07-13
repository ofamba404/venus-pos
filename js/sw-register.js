function serviceWorkerPath() {
  return /\/pages(?:\/|$)/.test(location.pathname) ? '../sw.js' : 'sw.js';
}

/** Register shell service worker — instant repeat visits, offline app chrome. */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  const register = () => {
    const url = new URL(serviceWorkerPath(), location.href).href;
    navigator.serviceWorker
      .register(url, { updateViaCache: 'none' })
      .catch((err) => console.warn('SW registration failed', err));
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
