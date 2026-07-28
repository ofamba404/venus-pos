import { runPageBoot } from '../bootstrap.js';
import { renderDeliveryAnalysis } from '../delivery.js';

runPageBoot({
  page: 'delivery',
  paint: renderDeliveryAnalysis,
  entities: ['deliveries'],
  slices: {
    deliveries: renderDeliveryAnalysis,
  },
});
