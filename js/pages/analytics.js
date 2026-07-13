import { finishAppInit, mountApp, revealApp } from '../app.js';
import { renderAnalytics, wireAnalyticsPage } from '../analytics.js';
import { hydrateFromCache, loadPageData } from '../bootstrap.js';
import { resetPageDataSettled, setPageDataSettled } from '../state.js';
import { setPageLoading } from '../utils.js';

async function boot() {
  resetPageDataSettled();
  hydrateFromCache();
  setPageLoading(true);

  try {
    mountApp('analytics');
    revealApp();
    wireAnalyticsPage();
    renderAnalytics();

    await Promise.all([finishAppInit(), loadPageData()]);
    setPageDataSettled();
    renderAnalytics();
  } finally {
    setPageLoading(false);
  }
}

boot();
