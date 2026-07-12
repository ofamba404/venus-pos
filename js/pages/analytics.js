import { initApp } from '../app.js';
import { renderAnalytics, wireAnalyticsPage } from '../analytics.js';
import { hydrateFromCache, loadPageData } from '../bootstrap.js';
import { setPageLoading } from '../utils.js';

async function boot() {
  hydrateFromCache();
  setPageLoading(true);

  try {
    await initApp('analytics');
    wireAnalyticsPage();
    renderAnalytics();
    await loadPageData();
    renderAnalytics();
  } finally {
    setPageLoading(false);
  }
}

boot();
