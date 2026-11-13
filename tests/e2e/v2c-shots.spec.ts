import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

const dir = process.env.V2C_SHOT_DIR || '/workspace/shots3';
const hideNav = (page: import('@playwright/test').Page) => page.addStyleTag({ content: '.shell__nav{display:none!important}' });

test('v2c: Clients, person sheets, Orders card, loaded order, History and edit sale at 390px', async ({ page }) => {
  test.setTimeout(150_000);
  mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const driver = await createNextDriver(page, { role: 'pos_admin' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Toasts are transient. Keep them out of the stills.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = '.v-toast-host{display:none!important}';
      document.head.appendChild(st);
    });
  });
  const accounts = driver.mock.db.table('store_accounts');
  accounts.push(
    { id: 'acc-debt', phone: '+256700333444', pos_display_name: 'Debt Storefront', verified: true },
    { id: 'acc-3', phone: '0772111222', pos_display_name: 'Test Client B', verified: true },
    { id: 'acc-4', phone: '0701555666', pos_display_name: 'Naluwooza Jane', verified: true },
    { id: 'acc-5', phone: '0752888999', pos_display_name: null, verified: false },
    { id: 'acc-6', phone: '0783444123', pos_display_name: 'Okello Brian', verified: true },
  );

  // Clients
  await page.goto('/next/clients');
  await page.locator('.client-card').first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${dir}/v2c-clients-all.png` });
  await page.screenshot({ path: `${dir}/v2c-clients-all-full.png`, fullPage: true });
  await page.getByTestId('client-filter-storefront').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/v2c-clients-storefront.png` });
  await page.getByTestId('client-filter-owes').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/v2c-clients-owes.png` });

  await page.getByTestId('client-filter-all').click();
  await page.getByRole('button', { name: /Client With Debt/ }).first().click();
  await page.getByTestId('person-sheet').waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/v2c-person-merged.png` });
  await page.getByTestId('person-sheet').evaluate((el) => el.closest('.v-sheet__body')?.scrollTo(0, 99999));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/v2c-person-merged-lower.png` });
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByTestId('client-filter-storefront').click();
  await page.getByTestId('person-acc-5').getByRole('button').click();
  await page.getByTestId('person-sheet').waitFor();
  await page.getByTestId('store-user-reset').click();
  await page.getByTestId('store-reset-code').waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${dir}/v2c-person-store-only.png` });

  // Orders pending card and loaded-order card
  const pending = driver.mock.db.table('store_orders').find((r) => r.id === 'seed-pending-order')!;
  pending.customer_name = 'Bartholomew Nakimuli Wolfeschlegelstein';
  pending.delivery_enabled = true;
  pending.location_label = 'Plot 14 Bukoto Street, Kamwokya, Kampala';
  pending.location_lat = 0.34;
  pending.location_lng = 32.58;
  pending.items = [
    { product_id: 'pilot', product_name: 'Pilot Pack', line_total: 15000, breakdown: { mint: 1, grape: 1 } },
    { product_id: 'scout', product_name: 'Scout Pack', line_total: 8000, breakdown: { strawberry: 1 } },
  ];
  await page.goto('/next/orders');
  const card = page.locator('article.v-order-card', { hasText: 'Wolfeschlegelstein' });
  await card.waitFor({ timeout: 20_000 });
  await page.waitForTimeout(600);
  await hideNav(page);
  await card.screenshot({ path: `${dir}/v2c-orders-pending-card.png` });
  await page.screenshot({ path: `${dir}/v2c-orders-pending-page.png` });

  await page.getByTestId('load-order-seed-pending-order').click();
  await page.waitForURL(/\/sell/);
  await page.getByTestId('loaded-order').waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  await hideNav(page);
  await page.screenshot({ path: `${dir}/v2c-loaded-order.png` });

  // History, edit sale, picker, Add item
  const sale = driver.mock.db.table('sales').find((r) => r.id === 'seed-sale-1')!;
  sale.items = [
    { product_id: 'pilot', product_name: 'Pilot Pack', detail: 'Mint x1, Grape x1', line_total: 15000, breakdown: { mint: 1, grape: 1 } },
    { product_id: 'plain_single', product_name: 'Plain', detail: 'x2', line_total: 10000, breakdown: { classic: 2 } },
  ];
  sale.total_ugx = 25000;
  sale.amount_paid_ugx = 25000;
  await page.goto('/next/history');
  await page.locator('[data-testid^="history-sale-"]').first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${dir}/v2c-history.png` });
  await page.screenshot({ path: `${dir}/v2c-history-full.png`, fullPage: true });
  await page.getByTestId('history-sale-seed-sale-1').click();
  await page.getByTestId('sale-edit').click();
  await page.getByRole('dialog', { name: 'Edit sale' }).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/v2c-edit-sale.png` });
  await page.getByTestId('sale-edit-flavours-0').click();
  await page.getByRole('dialog', { name: /Flavours/ }).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/v2c-edit-sale-picker.png` });
  await page.getByTestId('sale-edit-flavours-back').click();
  await page.getByTestId('sale-edit-add').click();
  await page.getByTestId('sale-add-catalog').waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/v2c-edit-sale-add-item.png` });
  await page.getByTestId('product-pilot').click();
  await page.getByTestId('config-flavor-melon-inc').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${dir}/v2c-edit-sale-add-item-picker.png` });
});
