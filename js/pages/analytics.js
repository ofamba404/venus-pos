import { runPageBoot } from '../bootstrap.js';
import {
  renderAnalytics,
  renderAnalyticsCharts,
  renderAnalyticsOverview,
  renderAnalyticsStock,
  wireAnalyticsPage,
} from '../analytics.js';

runPageBoot({
  page: 'analytics',
  wire: wireAnalyticsPage,
  paint: renderAnalytics,
  slices: {
    sales: [renderAnalyticsOverview, renderAnalyticsCharts],
    inventory: renderAnalyticsStock,
    clients: renderAnalyticsCharts,
  },
});
