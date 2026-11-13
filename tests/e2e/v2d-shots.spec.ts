import { mkdirSync } from 'node:fs';
import { test, type Page } from '@playwright/test';
import { createNextDriver } from './drivers/next';

const dir = process.env.V2C_SHOT_DIR || '/workspace/shots3';

async function boot(page: Page, width = 390) {
  await page.setViewportSize({ width, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = '.v-toast-host{display:none!important}';
      document.head.appendChild(st);
    });
  });
  return createNextDriver(page, { role: 'pos_admin' });
}

const hideNav = (page: Page) =>
  page.addStyleTag({ content: '.shell__nav{display:none!important}' }).catch(() => {});

test('v2d: money chart (profit bars, sales dots), restock, loaded order at 390px', async ({ page }) => {
  test.setTimeout(150_000);
  mkdirSync(dir, { recursive: true });
  const driver = await boot(page);
  for (const row of driver.mock.db.table('inventory')) if (!['mint', 'strawberry'].includes(String(row.category_id))) row.stock = 400;
  driver.mock.db.table('inventory').find((r) => r.category_id === 'mint')!.stock = 2;
  driver.mock.db.table('inventory').find((r) => r.category_id === 'strawberry')!.stock = 3;
  const sales = driver.mock.db.table('sales');
  // A varied month, so the best day by profit is not the best day by sales.
  const totals = [18000, 42000, 9000, 66000, 30000, 24000, 80000, 12000, 54000, 36000, 15000, 48000, 21000, 72000, 27000, 39000, 60000, 33000, 45000, 18000, 51000, 24000, 63000, 30000];
  totals.forEach((t, i) =>
    sales.push({
      id: `v2d-${i}`,
      created_at: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(),
      is_credit: false,
      total_ugx: t,
      items: [{ product_id: 'mint', line_total: t, breakdown: { mint: Math.max(1, Math.round(t / 12000)) } }],
    }),
  );

  await page.goto('/next/insights');
  await page.getByTestId('money-chart').waitFor();
  await page.waitForTimeout(800);
  await page.getByTestId('money-chart').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: '1W', exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByTestId('money-chart').screenshot({ path: `${dir}/v2d-insights-money-1w.png` });
  await page.getByRole('button', { name: '1M', exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByTestId('money-chart').screenshot({ path: `${dir}/v2d-insights-money-1m.png` });

  const restock = page.getByTestId('insights-restock');
  await restock.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await restock.screenshot({ path: `${dir}/v2d-insights-restock.png` });

  await page.goto('/next/orders');
  await hideNav(page);
  await page.getByTestId('load-order-seed-pending-order').click();
  await page.waitForURL(/\/sell/);
  await page.getByTestId('loaded-order').waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  await hideNav(page);
  await page.screenshot({ path: `${dir}/v2d-loaded-order.png` });
});

for (const width of [390, 360]) {
  test(`v2d: Clients filter chips on one row at ${width}px`, async ({ page }) => {
    mkdirSync(dir, { recursive: true });
    const driver = await boot(page, width);
    driver.mock.db.table('store_accounts').push(
      { id: 'acc-debt', phone: '+256700333444', pos_display_name: 'Debt Storefront', verified: true },
      { id: 'acc-4', phone: '0701555666', pos_display_name: 'Naluwooza Jane', verified: true },
    );
    await page.goto('/next/clients');
    await page.locator('.client-card').first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${dir}/v2d-clients-all-${width}.png` });
  });
}
