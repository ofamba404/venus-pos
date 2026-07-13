import { finishAppInit, mountApp, revealApp } from '../app.js';
import { renderAnalytics, wireAnalyticsPage } from '../analytics.js';
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
    mountApp('analytics');
    revealApp();
    wireAnalyticsPage();
    renderAnalytics();

    await Promise.all([finishAppInit(), loadPageData()]);
    setPageDataSettled();
    clearPendingFlags();
    renderAnalytics();
  } finally {
    setPageLoading(false);
  }
}

boot();
