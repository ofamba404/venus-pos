import { test } from '@playwright/test';
import { openCartScenario } from './helpers/open-cart';

test('Orders Review sale opens the Review sale sheet in place and keeps the cart (dev server)', async ({ page }) => {
  await openCartScenario(page);
});
