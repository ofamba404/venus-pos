import { mkdirSync } from 'node:fs';
import { test, type Page } from '@playwright/test';
import { createNextDriver } from './drivers/next';

const dir = process.env.V2C_SHOT_DIR || '/workspace/shots3';

async function boot(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = '.v-toast-host{display:none!important}';
      document.head.appendChild(st);
    });
  });
  const driver = await createNextDriver(page, { role: 'pos_admin' });
  const debtor = driver.mock.db.table('clients').find((c) => c.name === 'Client With Debt')!;
  driver.mock.db.table('credit_payments').push({ id: 'p1', client_id: debtor.id, amount_ugx: 5000, method: 'cash', created_at: new Date().toISOString() });
  return driver;
}

async function frame(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
}

test('v2c: Insights, money chart, restock, credit at 390px', async ({ page }) => {
  test.setTimeout(150_000);
  mkdirSync(dir, { recursive: true });
  const driver = await boot(page);
  // Mint is nearly out, so the restock card has something to order; the rest is fine.
  for (const row of driver.mock.db.table('inventory')) if (!['mint', 'strawberry'].includes(String(row.category_id))) row.stock = 400;
  driver.mock.db.table('inventory').find((r) => r.category_id === 'mint')!.stock = 2;
  driver.mock.db.table('inventory').find((r) => r.category_id === 'strawberry')!.stock = 3;
  const sales = driver.mock.db.table('sales');
  sales.push({
    id: 'shot-mint',
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    is_credit: false,
    total_ugx: 80000,
    items: [{ product_id: 'mint', line_total: 80000, breakdown: { mint: 20, strawberry: 12 } }],
  });

  await page.goto('/next/insights');
  await page.getByTestId('money-chart').waitFor();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${dir}/v2c-insights-top.png` });
  await page.screenshot({ path: `${dir}/v2c-insights-full.png`, fullPage: true });
  await frame(page, 'money-chart');
  await page.getByTestId('money-chart').screenshot({ path: `${dir}/v2c-insights-money-1w.png` });
  await page.getByRole('button', { name: '1M', exact: true }).click();
  await page.waitForTimeout(300);
  const bars = page.getByTestId('money-bar');
  const busy = await bars.evaluateAll((els) => els.findIndex((e) => Number(e.getAttribute('data-sales')) > 0));
  await bars.nth(busy).click();
  await page.waitForTimeout(300);
  await page.getByTestId('money-chart').screenshot({ path: `${dir}/v2c-insights-money-1m-picked.png` });
  await page.getByRole('button', { name: '1W', exact: true }).click();

  await frame(page, 'insights-restock');
  await page.getByTestId('insights-restock').screenshot({ path: `${dir}/v2c-insights-restock.png` });
  await page.getByTestId('restock-fine-toggle').click();
  await page.waitForTimeout(300);
  await page.getByTestId('insights-restock').screenshot({ path: `${dir}/v2c-insights-restock-open.png` });

  await frame(page, 'insights-credit');
  await page.getByTestId('insights-credit').screenshot({ path: `${dir}/v2c-insights-credit-collapsed.png` });
  await page.getByTestId('credit-toggle').click();
  await page.waitForTimeout(300);
  await page.getByTestId('insights-credit').screenshot({ path: `${dir}/v2c-insights-credit-expanded.png` });
  const b = page.locator('[data-testid^="credit-person-"]', { hasText: 'Test Client B' });
  await b.click();
  await page.waitForTimeout(300);
  await page.getByTestId('insights-credit').screenshot({ path: `${dir}/v2c-insights-credit-orders.png` });
  await page.locator('[data-testid^="credit-settle-order-"]').first().click();
  await page.getByTestId('credit-settle-sheet').waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/v2c-insights-credit-settle.png` });
});
