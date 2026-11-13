import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

const dir = process.env.V2C_SHOT_DIR || '/workspace/shots3';

test('v2e: calm Insights money section and page at 390px', async ({ page }) => {
  test.setTimeout(150_000);
  mkdirSync(dir, { recursive: true });
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
  for (const row of driver.mock.db.table('inventory')) if (!['mint'].includes(String(row.category_id))) row.stock = 400;
  driver.mock.db.table('inventory').find((r) => r.category_id === 'mint')!.stock = 2;
  const sales = driver.mock.db.table('sales');
  const totals = [18000, 42000, 9000, 66000, 30000, 24000, 80000];
  totals.forEach((t, i) =>
    sales.push({
      id: `v2e-${i}`,
      created_at: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(),
      is_credit: false,
      total_ugx: t,
      items: [{ product_id: 'mint', line_total: t, breakdown: { mint: Math.max(1, Math.round(t / 12000)) } }],
    }),
  );
  await page.goto('/next/insights');
  await page.getByTestId('money-chart').waitFor();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/v2e-insights-money-1w.png` });
  const bars = page.getByTestId('money-bar');
  const best = await bars.evaluateAll((els) => {
    let at = 0;
    els.forEach((e, i) => {
      if (Number(e.getAttribute('data-profit')) > Number(els[at]!.getAttribute('data-profit'))) at = i;
    });
    return at;
  });
  await bars.nth(best).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/v2e-insights-money-tapped.png` });
  await bars.nth(best).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/v2e-insights-full.png`, fullPage: true });
});
