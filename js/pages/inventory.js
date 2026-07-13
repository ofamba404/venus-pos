import { finishAppInit, mountApp, revealApp } from '../app.js';
import { renderInventoryGrid, syncInventoryToDom, wireInventoryPage } from '../inventory.js';
import { hydrateFromCache, loadPageData } from '../bootstrap.js';
import { resetPageDataSettled, setPageDataSettled } from '../state.js';
import { setPageLoading } from '../utils.js';

async function boot() {
  resetPageDataSettled();
  const cached = hydrateFromCache();
  setPageLoading(true);

  try {
    mountApp('inventory');
    revealApp();
    renderInventoryGrid({ pending: !cached.inventory });

    await Promise.all([finishAppInit(), loadPageData()]);
    setPageDataSettled();
    renderInventoryGrid();
    wireInventoryPage();
    syncInventoryToDom();
  } finally {
    setPageLoading(false);
  }
}

boot();
