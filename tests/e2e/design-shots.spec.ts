import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

const dir = process.env.SHOT_DIR || 'docs/overhaul/design-shots/after';

test('capture 390px screens', async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await createNextDriver(page, { role: 'pos_admin' });

  async function shot(name: string, path: string, ready: string) {
    await page.goto(path);
    await page.locator(ready).first().waitFor({ timeout: 20_000 });
    await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
  }

  await shot('sell', '/next/sell', '[data-testid="product-scout"]');
  await page.getByTestId('product-plain_single').click();
  await page.getByTestId('config-add').click();
  await page.getByRole('dialog', { name: 'Review sale' }).waitFor();
  await page.screenshot({ path: `${dir}/review-sheet.png`, fullPage: true });
  await page.keyboard.press('Escape');

  await shot('orders', '/next/orders', 'h1');
  await shot('history', '/next/history', 'h1');
  await page.getByTestId('history-sale-seed-sale-1').click();
  await page.getByTestId('sale-edit').click();
  await page.getByRole('dialog', { name: 'Edit sale' }).waitFor();
  await page.screenshot({ path: `${dir}/edit-sale.png`, fullPage: true });
  await page.keyboard.press('Escape');
  await shot('clients', '/next/clients', 'h1');
  await shot('insights', '/next/insights', 'h1');
  await shot('reviews', '/next/reviews', '.v-review');
  await shot('stock', '/next/stock', '[data-testid="stock-glance"]');
  await shot('more', '/next/more', 'h1');
});
