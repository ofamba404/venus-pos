import { expect, test, type Page } from '@playwright/test';
import { createNextDriver } from './drivers/next';
import { buildDefaultSeed } from '../fixtures/seed';
import { moneyChart } from '../../src/domain/money-chart';
import { restockPlan } from '../../src/domain/decisions-book';
import { restockSummary } from '../../src/domain/restock-summary';
import { CHART_RANGES } from '../../src/domain/analytics/periods';
import { historyOrDefault } from '../../src/domain/insights-view';

const range = (id: string) => CHART_RANGES.find((r) => r.id === id)!;
const num = async (page: Page, id: string) => Number(await page.getByTestId(id).getAttribute('data-value'));

test.describe('Insights: money chart', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('it replaces the three number tiles and sits above the restock list', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/insights');
    const chart = page.getByTestId('money-chart');
    await expect(chart).toBeVisible();
    await expect(page.getByText('What am I really making?')).toHaveCount(0);
    await expect(page.locator('.kpi-tile')).toHaveCount(0);
    // The chart comes before the restock card, and profit by pack stays.
    const order = await page.locator('section.decision').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    expect(order.indexOf('Sales and profit')).toBeLessThan(order.indexOf('What should I restock'));
    await expect(page.getByTestId('insights-rank')).toBeVisible();
  });

  for (const id of ['1w', 'lw', '2w', '1m', '3m', 'all']) {
    test(`range ${id}: totals match the domain and the bars add up to them`, async ({ page }) => {
      await createNextDriver(page, { role: 'pos_admin' });
      await page.goto('/next/insights');
      await page.getByRole('button', { name: range(id).short, exact: true }).click();
      const expected = moneyChart(buildDefaultSeed().sales as never, range(id), historyOrDefault(null), new Date());
      await expect(page.getByTestId('money-sales')).toHaveAttribute('data-value', String(expected.totals.sales));
      expect(await num(page, 'money-profit')).toBe(expected.totals.profit);
      if (expected.totals.sales === 0) {
        await expect(page.getByText('No sales in this range')).toBeVisible();
        return;
      }
      await expect(page.getByTestId('money-bar')).toHaveCount(expected.buckets.length);
      const sales = await page.getByTestId('money-bar').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-sales'))));
      expect(sales.reduce((a, b) => a + b, 0)).toBe(expected.totals.sales);
      await expect(page.getByTestId('money-plot')).toHaveAttribute('data-unit', expected.unit);
      // Profit is never more than sales, and the legend is you + helper + partner + joint cost.
      expect(await num(page, 'money-profit')).toBeLessThanOrEqual(await num(page, 'money-sales'));
      const parts = (await Promise.all(['owner', 'helper', 'partner', 'costs'].map((k) => num(page, `money-${k}`)))).reduce((a, b) => a + b, 0);
      expect(Math.abs(parts - (await num(page, 'money-sales')))).toBeLessThanOrEqual(2);
    });
  }

  test('tapping a bar shows that day, and tapping it again goes back to the whole range', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/insights');
    await page.getByRole('button', { name: '1M', exact: true }).click();
    const whole = await page.getByTestId('money-readout').innerText();
    expect(whole).toContain('Whole range, by day');
    const bars = page.getByTestId('money-bar');
    const busy = await bars.evaluateAll((els) => els.findIndex((e) => Number(e.getAttribute('data-sales')) > 0));
    const bar = bars.nth(busy);
    const sales = Number(await bar.getAttribute('data-sales'));
    await bar.click();
    await expect(bar).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('money-readout')).not.toContainText('Whole range');
    expect(await num(page, 'money-owner') + (await num(page, 'money-helper')) + (await num(page, 'money-partner')) + (await num(page, 'money-costs'))).toBeGreaterThanOrEqual(sales - 2);
    await bar.click();
    await expect(page.getByTestId('money-readout')).toContainText('Whole range, by day');
  });
});

test.describe('Insights: restock answers directly', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('the headline and the order list match restockPlan, and only urgent flavours are listed', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/insights');
    const stock = Object.fromEntries(driver.mock.db.table('inventory').map((r) => [String(r.category_id), Number(r.stock)]));
    const plan = restockPlan(buildDefaultSeed().sales as never, stock, new Date());
    const summary = restockSummary(plan);
    const head = page.getByTestId('restock-headline');
    await expect(head).toHaveText(summary.headline);
    await expect(page.locator('[data-testid^="restock-row-"]')).toHaveCount(summary.order.length);
    for (const row of summary.order) {
      await expect(page.getByTestId(`restock-qty-${row.id}`)).toHaveText(`Order ${row.orderQty}`);
    }
    if (summary.order.length) await expect(page.getByTestId('restock-key')).toContainText('2-week restock cycle');
    // The rest is one line, closed until tapped.
    await expect(page.getByTestId('restock-fine-list')).toHaveCount(0);
  });

  test('plenty of stock: "Nothing to restock this cycle", one fine line, expandable, copy list kept', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    for (const row of driver.mock.db.table('inventory')) row.stock = 500;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/next/insights');
    await expect(page.getByTestId('restock-headline')).toHaveText('Nothing to restock this cycle');
    await expect(page.locator('[data-testid^="restock-row-"]')).toHaveCount(0);
    await expect(page.getByTestId('restock-fine-line')).toHaveText(/^\d+ flavours fine for 2\+ weeks$/);
    await page.getByTestId('restock-fine-toggle').click();
    await expect(page.getByTestId('restock-fine-list')).toBeVisible();
    await expect(page.getByTestId('restock-fine-toggle')).toHaveAttribute('aria-expanded', 'true');
    await page.getByTestId('copy-restock').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Nothing to order');
  });

  test('a flavour that will run out is named with its quantity and days left', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    for (const row of driver.mock.db.table('inventory')) row.stock = 500;
    // Mint sells, and almost none is left.
    driver.mock.db.table('inventory').find((r) => r.category_id === 'mint')!.stock = 1;
    const sales = driver.mock.db.table('sales');
    for (const sale of sales) sale.created_at = new Date().toISOString();
    sales.push({ id: 'mint-seller', created_at: new Date().toISOString(), is_credit: false, total_ugx: 80000, items: [{ product_id: 'mint', line_total: 80000, breakdown: { mint: 40 } }] });
    await page.goto('/next/insights');
    const stock = Object.fromEntries(driver.mock.db.table('inventory').map((r) => [String(r.category_id), Number(r.stock)]));
    const summary = restockSummary(restockPlan(sales as never, stock, new Date()));
    expect(summary.order.map((r) => r.id)).toContain('mint');
    await expect(page.getByTestId('restock-headline')).toHaveText(summary.headline);
    const mint = summary.order.find((r) => r.id === 'mint')!;
    await expect(page.getByTestId('restock-qty-mint')).toHaveText(`Order ${mint.orderQty}`);
    await expect(page.getByTestId('restock-row-mint')).toContainText(/days? left|Under a day/);
  });
});
