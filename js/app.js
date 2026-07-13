import { ensureGsap, initSheetModals, wireFloatingNav } from './animations.js';
import { wireDebugPanel } from './debug.js';
import { mountShell } from './layout.js';
import { wireOrders } from './orders.js';
import { wireConfirmDialog, wireEditOverlay } from './utils.js';

export async function initApp(page) {
  mountShell(page);
  wireDebugPanel();
  wireConfirmDialog();
  wireEditOverlay();
  wireOrders();
  await ensureGsap();
  wireFloatingNav();
  initSheetModals();
}

/** Show the shell after data is rendered — no entrance motion. */
export function revealApp() {
  document.body.classList.add('is-ready');
}
