import { animatePageEntrance, ensureGsap, initSheetModals } from './animations.js';
import { wireDebugPanel } from './debug.js';
import { mountShell, wireMobileNav } from './layout.js';
import { wireOrders } from './orders.js';
import { wireConfirmDialog, wireEditOverlay } from './utils.js';

export async function initApp(page) {
  mountShell(page);
  wireMobileNav();
  wireDebugPanel();
  wireConfirmDialog();
  wireEditOverlay();
  wireOrders();
  await ensureGsap();
  initSheetModals();
  document.body.classList.add('is-ready');
  animatePageEntrance();
}
