import { wireDebugPanel } from './debug.js';
import { mountShell, wireMobileNav } from './layout.js';
import { wireOrders } from './orders.js';
import { wireThemeControls } from './theme.js';
import { wireConfirmDialog } from './utils.js';

export async function initApp(page) {
  mountShell(page);
  wireThemeControls();
  wireMobileNav();
  wireDebugPanel();
  wireConfirmDialog();
  wireOrders();
  document.body.classList.add('is-ready');
}
