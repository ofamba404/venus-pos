import { ensureGsap, initSheetModals, wireFloatingNav } from './animations.js';
import { wireDebugPanel } from './debug.js';
import { mountShell } from './layout.js';
import { wireOrders } from './orders.js';
import { wireConfirmDialog, wireEditOverlay } from './utils.js';

export function mountApp(page) {
  mountShell(page);
  wireDebugPanel();
  wireConfirmDialog();
  wireEditOverlay();
  wireOrders();
}

export async function finishAppInit() {
  await ensureGsap();
  wireFloatingNav();
  initSheetModals();
}

export async function initApp(page) {
  mountApp(page);
  await finishAppInit();
}

/** Show the shell immediately — content paints from cache or skeletons while fetching. */
export function revealApp() {
  document.body.classList.add('is-ready');
}
