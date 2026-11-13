import { expect, test, type Page } from '@playwright/test';
import { createNextDriver } from './drivers/next';
import { withHelper } from './helpers/helper';
import { buildDefaultSeed } from '../fixtures/seed';
import { moneyChart } from '../../src/domain/money-chart';
import { restockPlan, restockVerb } from '../../src/domain/decisions-book';
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
      await withHelper(page);
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
      // Profit is never more than sales, and the split strip is you + helper = profit.
      expect(await num(page, 'money-profit')).toBeLessThanOrEqual(await num(page, 'money-sales'));
      const split = (await num(page, 'money-owner')) + (await num(page, 'money-helper'));
      expect(Math.abs(split - (await num(page, 'money-profit')))).toBeLessThanOrEqual(1);
    });
  }

  test('no readout until a bar is tapped; the tap shows profit and sales for that day; tapping again clears it', async ({ page }) => {
    await withHelper(page);
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/insights');
    await page.getByRole('button', { name: '1M', exact: true }).click();
    await expect(page.getByTestId('money-readout')).toHaveText('');
    const bars = page.getByTestId('money-bar');
    const busy = await bars.evaluateAll((els) => els.findIndex((e) => Number(e.getAttribute('data-profit')) > 0));
    const bar = bars.nth(busy);
    const profit = Number(await bar.getAttribute('data-profit'));
    await bar.click();
    await expect(bar).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('money-readout')).toContainText('profit');
    await expect(page.getByTestId('money-readout')).toContainText('sales');
    expect(Math.abs((await num(page, 'money-owner')) + (await num(page, 'money-helper')) - profit)).toBeLessThanOrEqual(1);
    await bar.click();
    await expect(page.getByTestId('money-readout')).toHaveText('');
  });
});

test.describe('Insights: money chart is minimal', () => {
  test('bars are profit only, the tallest is the best day, and the section carries no scale, dots, partner or cost copy', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/insights');
    await page.getByRole('button', { name: '1M', exact: true }).click();
    const bars = page.getByTestId('money-bar');
    const info = await bars.evaluateAll((els) =>
      els.map((e) => ({
        profit: Number(e.getAttribute('data-profit')),
        h: (e.querySelector('.money__stack') as HTMLElement).getBoundingClientRect().height,
      })),
    );
    const best = info.reduce((a, b) => (b.profit > a.profit ? b : a));
    expect(best.profit).toBeGreaterThan(0);
    expect(Math.max(...info.map((i) => i.h))).toBeCloseTo(best.h, 0);
    const chart = page.getByTestId('money-chart');
    await expect(chart.locator('[data-part="costs"], [data-part="partner"], .money__dot, [data-testid="money-scale"], [data-testid="money-legend"]')).toHaveCount(0);
    const text = (await chart.innerText()).toLowerCase();
    for (const word of ['whole range', 'taken from sales', 'joint cost', 'cookie partner', 'profit is what you keep']) expect(text).not.toContain(word);
    // The two Sales/Profit tiles are gone: one hero figure and a small "of ... sales" line.
    await expect(chart.locator('.money__figure')).toHaveCount(0);
    await expect(page.getByTestId('money-sales')).toContainText('sales');
    const box = await page.getByTestId('money-plot').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  });

  test('sections are spaced evenly and generously', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/insights');
    await page.getByTestId('money-chart').waitFor();
    const gaps = await page.locator('.insights > section.decision').evaluateAll((els) =>
      els.slice(1).map((e, i) => Math.round(e.getBoundingClientRect().top - els[i]!.getBoundingClientRect().bottom)),
    );
    expect(gaps.length).toBeGreaterThan(3);
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(28);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(2);
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
      await expect(page.getByTestId(`restock-qty-${row.id}`)).toHaveText(`${restockVerb(row)} ${row.orderQty}`);
      // Plain text, not a pill.
      expect(await page.getByTestId(`restock-qty-${row.id}`).evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
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
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    for (const row of driver.mock.db.table('inventory')) row.stock = 500;
    // Mint sells, and almost none is left.
    driver.mock.db.table('inventory').find((r) => r.category_id === 'mint')!.stock = 1;
    const sales = driver.mock.db.table('sales');
    for (const sale of sales) sale.created_at = new Date().toISOString();
    sales.push({ id: 'mint-seller', created_at: new Date().toISOString(), is_credit: false, total_ugx: 80000, items: [{ product_id: 'mint', line_total: 80000, breakdown: { mint: 40 } }] });
    // A cookie flavour sells too, and is nearly out.
    sales.push({ id: 'cookie-seller', created_at: new Date().toISOString(), is_credit: false, total_ugx: 60000, items: [{ product_id: 'cookie_mint', line_total: 60000, breakdown: { cookie_mint: 30 } }] });
    const inv = driver.mock.db.table('inventory');
    const cookieRow = inv.find((r) => r.category_id === 'cookie_mint');
    if (cookieRow) cookieRow.stock = 1;
    else inv.push({ category_id: 'cookie_mint', stock: 1 });
    await page.goto('/next/insights');
    const stock = Object.fromEntries(driver.mock.db.table('inventory').map((r) => [String(r.category_id), Number(r.stock)]));
    const summary = restockSummary(restockPlan(sales as never, stock, new Date()));
    expect(summary.order.map((r) => r.id)).toContain('mint');
    expect(summary.order.map((r) => r.id)).toContain('cookie_mint');
    // The headline says Restock, joints say Roll, cookies say Order.
    await expect(page.getByTestId('restock-headline')).toHaveText(/^Restock \d+ flavours?$/);
    const cookie = summary.order.find((r) => r.id === 'cookie_mint')!;
    await expect(page.getByTestId('restock-qty-cookie_mint')).toHaveText(`Order ${cookie.orderQty}`);
    await expect(page.getByTestId('restock-headline')).toHaveText(summary.headline);
    const mint = summary.order.find((r) => r.id === 'mint')!;
    await expect(page.getByTestId('restock-qty-mint')).toHaveText(`Roll ${mint.orderQty}`);
    await expect(page.getByTestId('restock-row-mint')).toContainText(/days? left|Under a day/);
    await page.getByTestId('copy-restock').click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/Roll:\n(.+\n)*Mint — \d+/);
    expect(copied).toMatch(/Order:\nMint cookie — \d+/);
    expect(copied.indexOf('Roll:')).toBeLessThan(copied.indexOf('Order:'));
  });
});

test.describe('Insights: no helper until a start day is set', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('unset means no helper anywhere: no split, no helper card, one quiet way to add one', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/insights');
    await page.getByTestId('money-chart').waitFor();
    // Every day is yours alone, so there is nothing to split.
    await expect(page.getByTestId('money-split')).toHaveCount(0);
    await expect(page.getByTestId('money-helper')).toHaveCount(0);
    await expect(page.getByTestId('commission-ledger')).toHaveCount(0);
    await expect(page.getByTestId('commission-owed')).toHaveCount(0);
    await expect(page.getByTestId('helper-since-hint')).toHaveCount(0);
    await expect(page.getByTestId('insights-commission')).not.toContainText(/helper's|Helper\b.*owed/i);
    expect(await num(page, 'money-profit')).toBeGreaterThan(0);
    // The way to add one is a single muted line, with the date picker behind it.
    await expect(page.getByTestId('helper-since-input')).toHaveCount(0);
    await expect(page.getByTestId('helper-add-open')).toHaveText('Hired a helper? Set their start day');
    await page.getByTestId('helper-add-open').click();
    await expect(page.getByTestId('helper-since-input')).toBeVisible();
    await page.getByTestId('helper-add-cancel').click();
    await expect(page.getByTestId('helper-since-input')).toHaveCount(0);
  });

  test('setting a start day brings the helper back from that day, and it is remembered', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/insights');
    await page.getByTestId('money-chart').waitFor();
    await page.getByTestId('helper-add-open').click();
    await page.getByTestId('helper-since-input').fill('2000-01-01');
    await expect(page.getByTestId('commission-ledger')).toBeVisible();
    await expect(page.getByTestId('helper-add')).toHaveCount(0);
    expect(await num(page, 'money-helper')).toBeGreaterThan(0);

    await page.reload();
    await expect(page.getByTestId('helper-since-input')).toHaveValue('2000-01-01');

    // A start day in the future: still no sale on or after it, so the helper figures stay out of the chart.
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await page.getByTestId('helper-since-input').fill(tomorrow);
    await expect(page.getByTestId('money-split')).toHaveCount(0);
    await expect(page.getByTestId('commission-earned')).toHaveAttribute('data-value', '0');

    // Clear puts it back to no helper.
    await page.getByTestId('helper-since-clear').click();
    await expect(page.getByTestId('commission-ledger')).toHaveCount(0);
    await expect(page.getByTestId('helper-add-open')).toBeVisible();
  });
});
