import { finishAppInit, mountApp, revealApp } from '../app.js';
import { renderStockGlance } from '../inventory.js';
import { renderProductList } from '../orders.js';
import { hydrateFromCache, loadPageData } from '../bootstrap.js';
import { applyPendingFlags, clearPendingFlags } from '../pending.js';
import { resetPageDataSettled, setPageDataSettled } from '../state.js';
import { setPageLoading } from '../utils.js';
import { updateTodayStrip, wireHomePage } from '../home.js';

function paintHome() {
  renderProductList();
  updateTodayStrip();
  renderStockGlance();
}

async function boot() {
  resetPageDataSettled();
  const cached = hydrateFromCache();
  applyPendingFlags(cached);
  setPageLoading(true);

  try {
    mountApp('home');
    revealApp();
    wireHomePage();
    paintHome();

    await Promise.all([finishAppInit(), loadPageData()]);
    setPageDataSettled();
    clearPendingFlags();
    updateTodayStrip();
    renderStockGlance();
  } finally {
    setPageLoading(false);
  }
}

boot();
