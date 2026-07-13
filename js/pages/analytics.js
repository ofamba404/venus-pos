import { runPageBoot } from '../bootstrap.js';
import {
  renderAnalytics,
  renderAnalyticsCharts,
  renderAnalyticsOrders,
  renderAnalyticsOverview,
  renderAnalyticsStock,
  wireAnalyticsPage,
} from '../analytics.js';

runPageBoot({
  page: 'analytics',
  wire: wireAnalyticsPage,
  paint: renderAnalytics,
  slices: {
    sales: [renderAnalyticsOverview, renderAnalyticsCharts, renderAnalyticsOrders],
    inventory: renderAnalyticsStock,
    clients: renderAnalyticsCharts,
  },
});
