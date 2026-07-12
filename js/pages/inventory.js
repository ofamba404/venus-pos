import { initApp } from '../app.js';
import { renderInventoryGrid, syncInventoryToDom, wireInventoryPage } from '../inventory.js';
import { hydrateFromCache, loadPageData } from '../bootstrap.js';
import { setPageLoading } from '../utils.js';

async function boot() {
  hydrateFromCache();
  setPageLoading(true);

  try {
    await initApp('inventory');
    renderInventoryGrid();
    wireInventoryPage();
    await loadPageData();
    syncInventoryToDom();
  } finally {
    setPageLoading(false);
  }
}

boot();
