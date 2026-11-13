import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

const dir = process.env.V2C_SHOT_DIR || '/workspace/shots3';

test('v2f: restock card says Restock, joints Roll, cookies Order, at 390px', async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = '.v-toast-host{display:none!important}';
      document.head.appendChild(st);
    });
  });
  const driver = await createNextDriver(page, { role: 'pos_admin' });
  const inv = driver.mock.db.table('inventory');
  for (const row of inv) row.stock = 400;
  for (const id of ['mint', 'strawberry']) inv.find((r) => r.category_id === id)!.stock = 3;
  const cookie = inv.find((r) => r.category_id === 'cookie_mint');
  if (cookie) cookie.stock = 2;
  else inv.push({ category_id: 'cookie_mint', stock: 2 });
  driver.mock.db.table('sales').push({
    id: 'v2f-sold',
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    is_credit: false,
    total_ugx: 140000,
    items: [
      { product_id: 'mint', line_total: 80000, breakdown: { mint: 20, strawberry: 12 } },
      { product_id: 'cookie_mint', line_total: 60000, breakdown: { cookie_mint: 14 } },
    ],
  });
  await page.goto('/next/insights');
  const card = page.getByTestId('insights-restock');
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await card.screenshot({ path: `${dir}/v2f-insights-restock.png` });
  await page.getByTestId('copy-restock').click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  console.log(`COPIED:\n${copied}`);
});
