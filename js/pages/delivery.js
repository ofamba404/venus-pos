import { finishAppInit, mountApp, revealApp } from '../app.js';
import { loadDeliveries, renderDeliveryAnalysis } from '../delivery.js';
import { hydrateFromCache } from '../bootstrap.js';
import { applyPendingFlags, clearPendingFlags } from '../pending.js';
import { prepareOrderContext } from '../order-context.js';
import { resetPageDataSettled, setPageDataSettled } from '../state.js';
import { setPageLoading } from '../utils.js';

async function boot() {
  resetPageDataSettled();
  const cached = hydrateFromCache();
  applyPendingFlags(cached);
  setPageLoading(true);

  try {
    mountApp('delivery');
    revealApp();
    renderDeliveryAnalysis();

    await Promise.all([finishAppInit(), loadDeliveries(), prepareOrderContext()]);
    setPageDataSettled();
    clearPendingFlags();
    renderDeliveryAnalysis();
  } finally {
    setPageLoading(false);
  }
}

boot();
