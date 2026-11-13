import { expect, test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

test.describe('History grouping', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('only the latest day is open; the rest of this week is closed; older weeks fold into one heading each', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/history');
    const days = page.locator('[data-testid^="history-day-toggle-"]');
    await days.first().waitFor();
    const expanded = await days.evaluateAll((els) => els.map((e) => e.getAttribute('aria-expanded')));
    expect(expanded.filter((v) => v === 'true')).toHaveLength(1);
    expect(expanded[0]).toBe('true');
    // Older days sit under week headings, closed, so their days are not on screen yet.
    const weeks = page.locator('[data-testid^="history-week-toggle-"]');
    expect(await weeks.count()).toBeGreaterThan(0);
    expect(await weeks.first().getAttribute('aria-expanded')).toBe('false');
    // Open sale rows show only in the open day.
    const openDayRows = await page.locator('[data-testid^="history-sale-"]').count();
    expect(openDayRows).toBeGreaterThan(0);
  });

  test('one summary per day: "N sales" and the total once, no bare count', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/history');
    const first = page.getByTestId('history-day-sum').first();
    await expect(first).toHaveText(/^\d+ sales? · UGX [\d,]+/);
    expect(await page.getByTestId('history-day-sum').first().innerText()).not.toMatch(/·\s*\d+\s*·/);
    expect((await page.getByTestId('history-day-sum').first().innerText()).match(/UGX/g)!.length).toBeLessThanOrEqual(2);
  });

  test('tapping a heading opens and closes it, and the latest day is the open one', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/history');
    const toggle = page.locator('[data-testid^="history-day-toggle-"]').first();
    // The seed's clock is fixed in the past, so the latest day is a dated heading, not Today.
    await expect(toggle).toContainText(/Today|Yesterday|[A-Z][a-z]{2},? \d+ [A-Z][a-z]{2}/);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-testid^="history-sale-"]')).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-testid^="history-sale-"]').first()).toBeVisible();
  });

  test('credit rows show what is owed, not the total, and the Credit view opens every day', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/history');
    await page.getByRole('tab', { name: 'Credit' }).click();
    const owedRows = page.locator('[data-testid^="history-owed-"]');
    await owedRows.first().waitFor();
    const closed = await page.locator('[data-testid^="history-day-toggle-"][aria-expanded="false"]').count();
    expect(closed).toBe(0);
    const id = (await owedRows.first().getAttribute('data-testid'))!.replace('history-owed-', '');
    const sale = driver.mock.db.table('sales').find((s) => s.id === id)!;
    const total = Number(sale.total_ugx);
    const paid = Number(sale.amount_paid_ugx || 0);
    await expect(owedRows.first()).toContainText((total - paid).toLocaleString('en-UG'));
  });
});
