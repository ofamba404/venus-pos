import { test, expect } from '@playwright/test';
import { createNextDriver } from './drivers/next';
import { buildDefaultSeed } from '../fixtures/seed';
import { commissionLedger } from '../../src/domain/commission';

function deltas(driver: Awaited<ReturnType<typeof createNextDriver>>, categoryId: string) {
  return driver.mock.writes
    .filter(
      (w) =>
        (w.body as { op?: string } | null)?.op === 'delta' &&
        (w.body as { category_id?: string } | null)?.category_id === categoryId,
    )
    .map((w) => (w.body as { delta: number }).delta);
}

test.describe('owner decisions', () => {
  test('editing a sale reopens the flavour picker on its current flavours', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/history');
    await page.getByTestId('history-sale-seed-sale-1').click();
    await page.getByTestId('sale-edit').click();
    await page.getByTestId('sale-edit-flavours-0').click();

    const picker = page.getByRole('dialog', { name: /Flavours/ });
    await expect(picker).toBeVisible();
    // Prefilled: the sale has one mint.
    await expect(picker.getByTestId('config-flavor-mint-inc').locator('xpath=preceding-sibling::span')).toHaveText('1');
    await picker.getByTestId('config-flavor-mint-dec').click();
    await picker.getByTestId('config-flavor-strawberry-inc').click();
    await picker.getByTestId('sale-edit-flavours-apply').click();

    await page.getByTestId('sale-edit-save').click();
    await page.getByRole('status').filter({ hasText: /updated/i }).waitFor({ timeout: 8000 });

    const patch = driver.mock.writes
      .filter((w) => w.method === 'PATCH' && w.url.includes('/rest/v1/sales') && w.url.includes('seed-sale-1'))
      .at(-1)!.body as { total_ugx: number; items: Array<{ breakdown: Record<string, number>; detail: string }> };
    expect(patch.items[0]!.breakdown).toEqual({ strawberry: 1 });
    expect(patch.items[0]!.detail).toMatch(/Strawberry/);
    expect(patch.total_ugx).toBe(8000);
    expect(deltas(driver, 'mint')).toContain(1);
    expect(deltas(driver, 'strawberry')).toContain(-1);
  });

  test('backing out of the picker keeps the sale as it was', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/history');
    await page.getByTestId('history-sale-seed-sale-1').click();
    await page.getByTestId('sale-edit').click();
    await page.getByTestId('sale-edit-flavours-0').click();
    await page.getByTestId('config-flavor-strawberry-inc').click();
    await page.getByTestId('sale-edit-flavours-back').click();
    await expect(page.getByRole('dialog', { name: 'Edit sale' })).toBeVisible();
    await page.getByTestId('sale-edit-save').click();
    await page.getByRole('status').filter({ hasText: /updated/i }).waitFor({ timeout: 8000 });
    const patch = driver.mock.writes
      .filter((w) => w.method === 'PATCH' && w.url.includes('seed-sale-1'))
      .at(-1)!.body as { items: Array<{ breakdown: Record<string, number> }> };
    expect(patch.items[0]!.breakdown).toEqual({ mint: 1 });
  });

  test('helper commission is the 40% estimate, what is paid, and what is left', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    const seed = buildDefaultSeed();
    const want = commissionLedger(seed.sales as never, null, seed.staff_settlements);
    expect(want.paid).toBe(5000);
    expect(want.owed).toBe(want.earned - want.paid);
    await page.goto('/next/insights');
    const box = page.getByTestId('insights-commission');
    await expect(box.getByTestId('commission-earned')).toHaveAttribute('data-value', String(want.earned));
    await expect(box.getByTestId('commission-paid')).toHaveAttribute('data-value', '5000');
    await expect(box.getByTestId('commission-owed')).toHaveAttribute('data-value', String(want.owed));
    await expect(box.getByTestId('commission-owed')).toContainText(want.owed.toLocaleString('en-US'));
    await expect(box.getByTestId('commission-note')).toContainText('Last payout');
    await expect(box).toContainText('40% of profit');
  });

  test('commission says so when payouts cannot be read, instead of a wrong owed figure', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    driver.mock.setFailure({ method: 'GET', table: 'staff_settlements', status: 500, times: 5 });
    await page.goto('/next/insights');
    await expect(page.getByTestId('commission-owed')).toContainText('Payouts unavailable');
    await expect(page.getByTestId('commission-paid')).toHaveCount(0);
  });

  test('staff see stock but cannot change it', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await page.goto('/next/stock');
    await expect(page.getByTestId('stock-readonly')).toBeVisible();
    await expect(page.getByTestId('stock-mint-qty')).toHaveText('20');
    await expect(page.getByTestId('stock-mint-qty')).not.toHaveJSProperty('tagName', 'BUTTON');
    await expect(page.getByTestId('stock-mint-inc')).toHaveCount(0);
    await expect(page.getByTestId('stock-mint-dec')).toHaveCount(0);
    await page.getByTestId('stock-mint-qty').click({ force: true });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The page's own load ensures rows exist. It never sends a delta, a set, or a patch.
    const changes = driver.mock.writes.filter((w) => {
      const op = (w.body as { op?: string } | null)?.op;
      return w.url.includes('/rest/v1/inventory') || op === 'delta' || op === 'set';
    });
    expect(changes).toHaveLength(0);
    // The glance still reads for staff.
    await expect(page.getByTestId('stock-glance')).toContainText('out');
  });

  test('the owner can still count and set stock', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/stock');
    await expect(page.getByTestId('stock-readonly')).toHaveCount(0);
    await page.getByTestId('stock-mint-inc').click();
    await expect(page.getByTestId('stock-mint-qty')).toHaveText('21');
    expect(deltas(driver, 'mint')).toContain(1);
  });
});
