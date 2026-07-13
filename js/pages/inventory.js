import { initApp, revealApp } from '../app.js';
import { renderInventoryGrid, syncInventoryToDom, wireInventoryPage } from '../inventory.js';
import { hydrateFromCache, loadPageData } from '../bootstrap.js';
import { resetPageDataSettled, setPageDataSettled } from '../state.js';
import { setPageLoading } from '../utils.js';

async function boot() {
  resetPageDataSettled();
  hydrateFromCache();
  setPageLoading(true);

  try {
    await initApp('inventory');
    await loadPageData();
    setPageDataSettled();
    renderInventoryGrid();
    wireInventoryPage();
    syncInventoryToDom();
    revealApp();
  } finally {
    setPageLoading(false);
  }
}

boot();
