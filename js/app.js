import { ensureGsap, wireFloatingNav } from './animations.js';
import { wireAdminPanel } from './admin.js';
import { wireDebugPanel } from './debug.js';
import { mountShell } from './layout.js';
import { wireOrders } from './orders.js';
import { bootPwa } from './pwa.js';
import { startReviewsRuntime } from './reviews.js';
import { startStoreOrdersRuntime } from './store-orders.js';
import { registerServiceWorker } from './sw-register.js';
import { wireSettleOverlay } from './settle-credit.js';
import { wireConfirmDialog, wireEditOverlay } from './utils.js';

let shellMounted = false;
let runtimesStarted = false;

/**
 * Mount chrome once for the session. Page content is swapped by the view cache.
 */
export function mountAppOnce(page) {
  if (!shellMounted) {
    mountShell(page);
    shellMounted = true;
  }
  if (!runtimesStarted) {
    wireDebugPanel();
    wireAdminPanel();
    wireConfirmDialog();
    wireEditOverlay();
    wireSettleOverlay();
    wireOrders();
    startStoreOrdersRuntime();
    startReviewsRuntime();
    runtimesStarted = true;
  }
}

/** @deprecated Use mountAppOnce — shell must not remount on tab changes. */
export function mountApp(page) {
  mountAppOnce(page);
}

export async function finishAppInit() {
  if (finishAppInit._done) return;
  finishAppInit._done = true;
  registerServiceWorker();
  bootPwa();
  wireFloatingNav();
  // GSAP is decorative — never block data hydration / first paint on it.
  void ensureGsap();
}

export async function initApp(page) {
  mountAppOnce(page);
  await finishAppInit();
}

/** Show the shell immediately — content paints from cache or skeletons while fetching. */
export function revealApp() {
  document.body.classList.add('is-ready');
}
