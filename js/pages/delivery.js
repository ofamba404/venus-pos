import { runPageBoot } from '../bootstrap.js';
import { renderDeliveryAnalysis } from '../delivery.js';

runPageBoot({
  page: 'delivery',
  paint: renderDeliveryAnalysis,
  slices: {
    deliveries: renderDeliveryAnalysis,
  },
});
