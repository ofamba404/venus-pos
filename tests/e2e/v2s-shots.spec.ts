import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

const dir = '/workspace/shots3';

test('v2s screenshots at 390px', async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await createNextDriver(page, { role: 'pos_admin' });

  await page.goto('/next/sell');
  await page.getByTestId('orders-badge').waitFor();
  await page.waitForTimeout(200);
  await page.locator('.shell__nav').screenshot({ path: `${dir}/v2s-nav-badge.png` });
  await page.getByTestId('product-plain_single').click();
  await page.getByTestId('config-add').click();
  const cart = page.getByRole('dialog', { name: 'Cart' });
  await cart.waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/v2s-cart-top.png` });
  await cart.getByRole('tab', { name: 'Delivery' }).click();
  await cart.getByTestId('cart-client').fill('Test Cli');
  await cart.getByTestId('client-suggest').waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/v2s-client-autocomplete.png` });
  await cart.getByTestId('client-suggest').getByText('Test Client A').click();
  await cart.locator('.delivery-block').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/v2s-cart-delivery.png` });
  await cart.getByRole('button', { name: 'Close' }).click();

  await page.goto('/next/orders');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/v2s-orders-waiting.png` });
  await page.getByRole('tab', { name: /In sale/ }).click();
  await page.getByTestId('order-card-so-confirmed-1').waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/v2s-orders-insale.png` });
  await page.getByTestId('order-card-so-confirmed-1').screenshot({ path: `${dir}/v2s-order-card-time-pill.png` });
  await page.getByTestId('view-order-so-confirmed-1').click();
  await page.getByTestId('store-order-sheet').waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${dir}/v2s-store-order-sheet.png` });
  await page.getByRole('dialog', { name: 'Store order' }).getByRole('button', { name: 'Close' }).click();

  await page.goto('/next/clients');
  await page.getByTestId('client-filters').waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/v2s-clients-chips.png` });
  await page.getByTestId('client-search').fill('Test Cli');
  await page.getByTestId('client-list').getByText('Test Client A').waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/v2s-clients-search-typing.png` });
  await page.getByTestId('client-search').fill('');
  await page.getByTestId('client-search').blur();
  await page.getByTestId('client-filter-storefront').click();
  await page.getByTestId('person-acc-2').getByRole('button').click();
  const sheet = page.getByTestId('person-sheet');
  await sheet.getByTestId('store-user-reset').click();
  await sheet.getByTestId('copy-reset-code').waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/v2s-reset-code-copy.png` });
});
