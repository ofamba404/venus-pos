import { test, expect } from '@playwright/test';
import { createNextDriver } from './drivers/next';

test('recent-client scout sale is at most 6 taps', async ({ page }) => {
  await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/sell');
  await page.getByTestId('product-scout').waitFor();
  let taps = 0;
  const tap = async (target: ReturnType<typeof page.getByTestId>) => {
    await target.click();
    taps += 1;
  };
  await tap(page.getByTestId('product-scout'));
  await tap(page.getByTestId('config-flavor-mint-inc'));
  await tap(page.getByTestId('config-add'));
  const review = page.getByRole('dialog', { name: 'Review sale' });
  await tap(review.getByRole('button', { name: 'Test Client A' }).first());
  await tap(review.getByTestId('charge'));
  expect(taps).toBeLessThanOrEqual(6);
  await page.getByText(/Sale recorded/).first().waitFor({ timeout: 10000 });
});

test('charge stays disabled until a customer is chosen', async ({ page }) => {
  await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/sell');
  await page.getByTestId('product-plain_single').click();
  await page.getByTestId('config-add').click();
  const charge = page.locator('[data-desktop-cart]').getByTestId('charge');
  await expect(charge).toBeDisabled();
  await expect(page.locator('[data-desktop-cart]').getByTestId('charge-reason')).toHaveText(
    'Add a customer to continue',
  );
});

test('undo puts a removed line back', async ({ page }) => {
  await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/sell');
  await page.getByTestId('product-plain_single').click();
  await page.getByTestId('config-add').click();
  const review = page.getByRole('dialog', { name: 'Review sale' });
  await review.getByRole('button', { name: /Remove Plain/i }).click();
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('dialog', { name: 'Review sale' }).getByText('Plain').first()).toBeVisible();
});

test('tile to config sheet is under 100ms in the page', async ({ page }) => {
  await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/sell');
  await page.getByTestId('product-scout').waitFor();
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const ms = await page.evaluate(async () => {
    const tile = document.querySelector('[data-testid="product-scout"]');
    if (!(tile instanceof HTMLElement)) return 9999;
    const start = performance.now();
    tile.click();
    const deadline = start + 1000;
    while (performance.now() < deadline) {
      if (document.querySelector('[data-testid="config-add"]')) return performance.now() - start;
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    }
    return performance.now() - start;
  });
  expect(ms).toBeLessThanOrEqual(100);
});
