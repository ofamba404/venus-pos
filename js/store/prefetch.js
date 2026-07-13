import { dataStore } from './data-store.js';

const PREFETCH_ORDER = ['inventory', 'clients', 'deliveries', 'sales'];
const IDLE_TIMEOUT_MS = 2500;

let prefetchScheduled = false;
let navWired = false;

function runWhenIdle(fn) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(fn, { timeout: IDLE_TIMEOUT_MS });
  } else {
    setTimeout(fn, 120);
  }
}

/** Quietly refresh entities that are missing or stale — used after Home paints. */
export function scheduleIdlePrefetch(entities = PREFETCH_ORDER) {
  if (prefetchScheduled) return;
  prefetchScheduled = true;

  runWhenIdle(async () => {
    const stale = entities.filter((e) => !dataStore.isFresh(e));
    if (stale.length) {
      await dataStore.fetchAll(stale, { silent: true });
    }
    prefetchScheduled = false;
  });
}

/** Prefetch a single entity on nav hover/touch — never blocks navigation. */
export function prefetchEntity(entity) {
  if (dataStore.isFresh(entity)) return;
  dataStore.fetch(entity, { silent: true });
}

export function wireNavPrefetch(root = document) {
  if (navWired) return;
  navWired = true;

  const routeEntity = {
    inventory: 'inventory',
    clients: 'clients',
    delivery: 'deliveries',
    analytics: 'sales',
    home: null,
  };

  const triggerPrefetch = (href) => {
    if (!href) return;
    const page = Object.keys(routeEntity).find((id) => href.includes(`${id}.html`) || (id === 'home' && href.includes('index.html')));
    const entity = page ? routeEntity[page] : null;
    if (entity) prefetchEntity(entity);
    if (page === 'analytics') {
      prefetchEntity('inventory');
      prefetchEntity('clients');
    }
    if (page === 'delivery') {
      prefetchEntity('clients');
    }
  };

  root.querySelectorAll('a[href]').forEach((link) => {
    const href = link.getAttribute('href');
    if (!href?.includes('.html')) return;
    link.addEventListener('mouseenter', () => triggerPrefetch(href), { passive: true });
    link.addEventListener('focus', () => triggerPrefetch(href), { passive: true });
    link.addEventListener('touchstart', () => triggerPrefetch(href), { passive: true });
  });
}
