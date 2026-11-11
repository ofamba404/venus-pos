import { getPageHref } from './config.js';

const SPA_PAGES = new Set([
  'home',
  'inventory',
  'clients',
  'reviews',
  'delivery',
  'history',
  'analytics',
  'admin',
]);

/** @type {(pageId: string, opts?: { replace?: boolean, hash?: string }) => Promise<void>} */
let activateHandler = null;

export function resolvePageFromLocation() {
  const path = location.pathname;
  if (/admin\.html$/i.test(path)) return 'admin';
  if (/inventory\.html$/i.test(path)) return 'inventory';
  if (/clients\.html$/i.test(path)) return 'clients';
  if (/reviews\.html$/i.test(path)) return 'reviews';
  if (/delivery\.html$/i.test(path)) return 'delivery';
  if (/history\.html$/i.test(path)) return 'history';
  if (/analytics\.html$/i.test(path)) return 'analytics';
  if (/home\.html$/i.test(path)) return 'home';
  // index.html or site root
  return 'home';
}

export function isSpaPage(pageId) {
  return SPA_PAGES.has(pageId);
}

export function pageIdFromHref(href) {
  if (!href) return null;
  try {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return null;
    if (/auth\.html$/i.test(url.pathname)) return null;
    const page = resolvePageFromPathname(url.pathname);
    return isSpaPage(page) ? page : null;
  } catch {
    return null;
  }
}

function resolvePageFromPathname(pathname) {
  if (/admin\.html$/i.test(pathname)) return 'admin';
  if (/inventory\.html$/i.test(pathname)) return 'inventory';
  if (/clients\.html$/i.test(pathname)) return 'clients';
  if (/reviews\.html$/i.test(pathname)) return 'reviews';
  if (/delivery\.html$/i.test(pathname)) return 'delivery';
  if (/history\.html$/i.test(pathname)) return 'history';
  if (/analytics\.html$/i.test(pathname)) return 'analytics';
  if (/home\.html$/i.test(pathname)) return 'home';
  if (/index\.html$/i.test(pathname) || /\/$/.test(pathname) || pathname.endsWith('/venus-pos')) {
    return 'home';
  }
  return null;
}

/**
 * Soft-navigate without unloading the document.
 * Falls back to full navigation if the SPA activator is not ready.
 */
export async function navigate(pageId, { replace = false, hash = '' } = {}) {
  if (!isSpaPage(pageId)) {
    location.href = getPageHref(pageId, hash);
    return;
  }
  if (!activateHandler) {
    location.href = getPageHref(pageId, hash);
    return;
  }
  await activateHandler(pageId, { replace, hash });
}

export function setActivateHandler(fn) {
  activateHandler = fn;
}

/** Intercept same-origin POS tab links for soft navigation. */
export function wireSpaNavigation(root = document) {
  if (root.dataset?.spaNavWired === '1') return;
  if (root === document) {
    // mark on body so we only wire once
    if (document.body.dataset.spaNavWired === '1') return;
    document.body.dataset.spaNavWired = '1';
  } else if (root.dataset) {
    root.dataset.spaNavWired = '1';
  }

  root.addEventListener('click', (event) => {
    const link = event.target?.closest?.('a[href]');
    if (!link) return;
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.target && link.target !== '_self') return;
    if (link.hasAttribute('download')) return;

    const href = link.getAttribute('href');
    // Same-document hash links (skip-to-content, in-page anchors) must stay native.
    if (!href || href.startsWith('#')) return;

    const pageId = pageIdFromHref(href);
    if (!pageId) return;

    event.preventDefault();
    const url = new URL(href, location.href);
    void navigate(pageId, { hash: url.hash || '' });
  });

  window.addEventListener('popstate', () => {
    const pageId = resolvePageFromLocation();
    if (!activateHandler || !isSpaPage(pageId)) return;
    void activateHandler(pageId, {
      replace: true,
      fromPop: true,
      hash: location.hash || '',
    });
  });
}
