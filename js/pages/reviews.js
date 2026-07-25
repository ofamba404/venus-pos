import { runPageBoot } from '../bootstrap.js';
import { loadReviews, renderReviews, wireReviewsPage } from '../reviews.js';

runPageBoot({
  page: 'reviews',
  wire: () => {
    wireReviewsPage();
    void loadReviews();
  },
  paint: renderReviews,
  entities: [],
  slices: {},
});
