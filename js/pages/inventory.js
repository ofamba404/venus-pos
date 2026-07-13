import { finishAppInit, mountApp, revealApp } from '../app.js';
import { renderInventoryGrid, syncInventoryToDom, wireInventoryPage } from '../inventory.js';
import { hydrateFromCache, loadPageData } from '../bootstrap.js';
import { applyPendingFlags, clearPendingFlags } from '../pending.js';
import { resetPageDataSettled, setPageDataSettled } from '../state.js';
import { setPageLoading } from '../utils.js';

async function boot() {
  resetPageDataSettled();
  const cached = hydrateFromCache();
  applyPendingFlags(cached);
  setPageLoading(true);

  try {
    mountApp('inventory');
    revealApp();
    renderInventoryGrid();
    wireInventoryPage();

    await Promise.all([finishAppInit(), loadPageData()]);
    setPageDataSettled();
    clearPendingFlags();
    syncInventoryToDom();
  } finally {
    setPageLoading(false);
  }
}

boot();
