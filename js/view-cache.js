/**
 * Keep-alive page views: inactive pages detach from the document
 * (avoids duplicate IDs) but retain DOM + listeners for instant return.
 */

const views = new Map();
/** @type {string | null} */
let activePageId = null;

function host() {
  return document.getElementById('page-content');
}

export function getActivePageId() {
  return activePageId;
}

export function createPageView(pageId, html) {
  const el = document.createElement('div');
  el.className = 'page-view-inner';
  el.dataset.pageView = pageId;
  el.innerHTML = html;
  views.set(pageId, { el, scrollY: 0, wired: false });
  return views.get(pageId);
}

export function getPageView(pageId) {
  return views.get(pageId) || null;
}

export function hasPageView(pageId) {
  return views.has(pageId);
}

/**
 * Attach `pageId` into #page-content; detach the previous view (keep-alive).
 * Returns the view record.
 */
export function showPageView(pageId) {
  const main = host();
  if (!main) return null;

  const prevId = activePageId;
  if (prevId && prevId !== pageId) {
    const prev = views.get(prevId);
    if (prev?.el?.isConnected) {
      prev.scrollY = main.scrollTop || window.scrollY || 0;
      // Detach — listeners stay on the node.
      prev.el.remove();
    }
  }

  let view = views.get(pageId);
  if (!view) return null;

  if (!view.el.isConnected) {
    main.replaceChildren(view.el);
  }
  activePageId = pageId;

  requestAnimationFrame(() => {
    const y = view.scrollY || 0;
    if (main.scrollHeight > main.clientHeight) {
      main.scrollTop = y;
    } else {
      window.scrollTo(0, y);
    }
  });

  return view;
}

export function markPageWired(pageId) {
  const view = views.get(pageId);
  if (view) view.wired = true;
}

export function isPageWired(pageId) {
  return !!views.get(pageId)?.wired;
}
