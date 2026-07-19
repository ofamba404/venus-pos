import { ensureGsap, wireFloatingNav } from './animations.js';
import { wireAdminPanel } from './admin.js';
import { wireDebugPanel } from './debug.js';
import { initQuoteLabReminders } from './delivery-quote-lab.js';
import { mountShell } from './layout.js';
import { wireOrders } from './orders.js';
import { startStoreOrdersRuntime } from './store-orders.js';
import { registerServiceWorker } from './sw-register.js';
import { wireSettleOverlay } from './settle-credit.js';
import { wireConfirmDialog, wireEditOverlay } from './utils.js';

export function mountApp(page) {
  mountShell(page);
  wireDebugPanel();
  wireAdminPanel();
  wireConfirmDialog();
  wireEditOverlay();
  wireSettleOverlay();
  wireOrders();
  startStoreOrdersRuntime();
}

export async function finishAppInit() {
  registerServiceWorker();
  initQuoteLabReminders();
  await ensureGsap();
  wireFloatingNav();
}

export async function initApp(page) {
  mountApp(page);
  await finishAppInit();
}

/** Show the shell immediately — content paints from cache or skeletons while fetching. */
export function revealApp() {
  document.body.classList.add('is-ready');
}
