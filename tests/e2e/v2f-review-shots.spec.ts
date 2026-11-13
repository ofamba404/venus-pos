import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

const dir = process.env.V2C_SHOT_DIR || '/workspace/shots3';

test('v2f: Review sale delivery and pickup, Orders badges at 390px', async ({ page }) => {
  test.setTimeout(90_000);
  mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/sell');
  await page.getByTestId('product-scout').click();
  await page.getByTestId('config-flavor-mint-inc').click();
  await page.getByTestId('config-add').click();
  const sheet = page.getByRole('dialog', { name: 'Review sale' });
  await sheet.getByRole('tab', { name: 'Delivery' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/v2f-review-delivery.png` });
  await sheet.getByRole('tab', { name: 'Pickup' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/v2f-review-pickup.png` });
  await page.goto('/next/orders');
  await page.getByRole('tab', { name: /In sale/ }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/v2f-orders-in-sale.png` });
  await page.getByRole('tab', { name: /Closed/ }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/v2f-orders-closed.png` });
});
