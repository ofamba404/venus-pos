import { expect, type Page } from '@playwright/test';
import { createNextDriver } from '../drivers/next';

const PENDING = 'seed-pending-order';

/**
 * Orders > In sale > Review sale must open the Review sale sheet on Sell, in place, with the cart as it was.
 * It used to re-run "Load into sale": a plain navigation to Sell, and it threw away edits made to the cart.
 */
export async function openCartScenario(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/orders');
  await page.getByTestId(`load-order-${PENDING}`).click();
  await page.waitForURL(/\/next\/sell/);
  await page.getByTestId('loaded-order').waitFor();

  // Edit the loaded cart: add a Scout pack with one flavour.
  await page.getByTestId('product-scout').click();
  await page.getByTestId('config-flavor-mint-inc').click();
  await page.getByTestId('config-add').click();
  // Adding the pack already opens the Review sale sheet.
  const sheet = page.getByRole('dialog', { name: 'Review sale' });
  const lines = await sheet.getByTestId('line-qty').count();
  expect(lines).toBeGreaterThanOrEqual(2);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await sheet.waitFor({ state: 'hidden' });

  // Leave, then come back through Review sale.
  await page.goto('/next/orders');
  await page.getByRole('tab', { name: 'In sale' }).click();
  const open = page.getByTestId(`load-order-${PENDING}`);
  await expect(open).toHaveText('Review sale');
  await open.click();
  await page.waitForURL(/\/next\/sell\/?$/);
  const again = page.getByRole('dialog', { name: 'Review sale' });
  await expect(again).toBeVisible();
  await expect(again.getByTestId('loaded-order-cart')).toBeVisible();
  // Nothing was reset: the extra pack is still there.
  await expect(again.getByTestId('line-qty')).toHaveCount(lines);
  // The request is used up: closing the sheet and reloading Sell does not reopen it.
  await again.getByRole('button', { name: 'Close' }).click();
  await again.waitFor({ state: 'hidden' });
  await page.goto('/next/sell');
  await page.getByTestId('loaded-order').waitFor();
  await expect(page.getByRole('dialog', { name: 'Review sale' })).toHaveCount(0);
}
