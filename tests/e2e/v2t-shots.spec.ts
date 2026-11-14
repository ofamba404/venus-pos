import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

const dir = '/workspace/shots3';

test('v2t screenshots at 390px', async ({ page }) => {
  test.setTimeout(90_000);
  mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await createNextDriver(page, { role: 'pos_admin' });

  await page.goto('/next/sell');
  await page.getByTestId('today-pill').waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/v2t-sell-groups.png` });
  await page.getByTestId('store-status-btn').waitFor();
  await page.locator('.sell-today').screenshot({ path: `${dir}/v2t-store-status.png` });
  await page.getByTestId('store-status-btn').click();
  await page.getByRole('dialog', { name: 'Hours' }).waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/v2t-hours-sheet.png` });
  await page.getByRole('dialog', { name: 'Hours' }).getByRole('button', { name: 'Close' }).click();
  await page.getByRole('dialog', { name: 'Hours' }).waitFor({ state: 'hidden' });

  await page.getByTestId('review-bar').waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/v2t-sell-review-bar.png` });

  await page.getByTestId('product-plain_single').click();
  await page.getByTestId('config-add').click();
  const cart = page.getByRole('dialog', { name: 'Cart' });
  await cart.waitFor();
  await cart.getByTestId('cart-client').fill('Test Cli');
  await cart.getByTestId('client-chips').locator('strong').first().waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/v2t-cart-client-chips.png` });
  await cart.getByTestId('cart-client').fill('Zuzu New');
  await cart.getByTestId('add-client').waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/v2t-cart-add-client.png` });
});
