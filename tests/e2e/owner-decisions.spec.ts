import { test, expect } from '@playwright/test';
import { createNextDriver } from './drivers/next';
import { buildDefaultSeed } from '../fixtures/seed';
import { commissionLedger } from '../../src/domain/commission';
import { openSale } from './helpers/history';
import { withHelper } from './helpers/helper';
import { helperConfig } from '../../src/domain/economics';

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
    await openSale(page, 'seed-sale-1');
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
    await openSale(page, 'seed-sale-1');
    await page.getByTestId('sale-edit').click();
    await page.getByTestId('sale-edit-flavours-0').click();
    await page.getByTestId('config-flavor-mint-dec').click();
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
    await withHelper(page);
    await createNextDriver(page, { role: 'pos_admin' });
    const seed = buildDefaultSeed();
    helperConfig.since = '2000-01-01';
    const want = commissionLedger(seed.sales as never, null, seed.staff_settlements);
    helperConfig.since = null;
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
    await withHelper(page);
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

  test('busy mode is one switch for delivery and pickup', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/store');
    // No delivery/pickup split on this page.
    await expect(page.getByRole('button', { name: /^(Delivery|Pickup)$/ })).toHaveCount(0);
    await page.getByTestId('busy-30').click();
    await expect(page.getByTestId('store-status')).toContainText('Busy');
    const patch = () =>
      driver.mock.writes.filter((w) => w.method === 'PATCH' && w.url.includes('store_fulfillment')).at(-1)!
        .body as { busy_for: string | null; busy_until: string | null };
    await expect.poll(() => patch().busy_for).toBe('both');
    expect(patch().busy_until).toBeTruthy();
    await page.getByTestId('busy-clear').click();
    await expect.poll(() => patch().busy_for).toBeNull();
    expect(patch().busy_until).toBeNull();
  });

  test('long client names wrap on an order card instead of being cut off', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await page.setViewportSize({ width: 360, height: 780 });
    const longName = 'Bartholomew Nakimuli Wolfeschlegelstein Mukasa Junior';
    const row = driver.mock.db.table('store_orders').find((r) => r.id === 'so-confirmed-1')!;
    row.customer_name = longName;
    await page.goto('/next/orders');
    await page.getByRole('tab', { name: /In sale/ }).click();
    const title = page.locator('.order-card__who .v-list-row__title', { hasText: 'Bartholomew' });
    await expect(title).toBeVisible();
    await expect(title).toHaveText(longName);
    const box = await title.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        clipped: el.scrollWidth > el.clientWidth + 1,
        whiteSpace: style.whiteSpace,
        textOverflow: style.textOverflow,
        lines: Math.round(el.getBoundingClientRect().height / parseFloat(style.lineHeight)),
      };
    });
    expect(box.whiteSpace).toBe('normal');
    expect(box.textOverflow).not.toBe('ellipsis');
    expect(box.clipped).toBe(false);
    expect(box.lines).toBeGreaterThan(1);
    // The card stays inside the screen.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });

  test('the edit-sale picker holds a pack to its joint count', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/history');
    await openSale(page, 'seed-sale-1');
    await page.getByTestId('sale-edit').click();
    await page.getByTestId('sale-edit-flavours-0').click();
    const picker = page.getByRole('dialog', { name: /Flavours/ });
    const apply = picker.getByTestId('sale-edit-flavours-apply');
    // Scout is 1 joint and the sale has 1 Mint: the pack is full.
    await expect(picker.getByTestId('slot-meter')).toHaveAttribute('data-picked', '1');
    await expect(picker.getByTestId('slot-meter')).toContainText('1 of 1');
    await expect(apply).toBeEnabled();
    await expect(picker.getByTestId('config-flavor-strawberry-inc')).toBeDisabled();
    await expect(picker.getByTestId('config-flavor-mint-inc')).toBeDisabled();
    // Empty it: the exact count is required.
    await picker.getByTestId('config-flavor-mint-dec').click();
    await expect(apply).toBeDisabled();
    await expect(apply).toContainText('Pick 1');
    await expect(picker.getByTestId('config-flavor-strawberry-inc')).toBeEnabled();
    await picker.getByTestId('config-flavor-strawberry-inc').click();
    await expect(apply).toBeEnabled();
    await expect(picker.getByTestId('config-flavor-grape-inc')).toBeDisabled();
  });

  for (const [id, target, total] of [
    ['scout', 1, 1],
    ['pilot', 2, 2],
    ['commander', 5, 5],
    ['variety', 7, 8],
    ['cookie_duet', 2, 2],
    ['cookie_trio', 3, 3],
  ] as const) {
    test(`Sell's ${id} picker stops at ${target} flavours and needs exactly ${target}`, async ({ page }) => {
      await createNextDriver(page, { role: 'pos_admin' });
      await page.goto('/next/sell');
      await page.getByTestId(`product-${id}`).click();
      const dialog = page.getByRole('dialog').last();
      const add = dialog.getByTestId('config-add');
      const incs = dialog.locator('[data-testid^="config-flavor-"][data-testid$="-inc"]');
      await expect(add).toBeDisabled();
      for (let i = 0; i < target; i += 1) {
        await expect(add).toBeDisabled();
        await incs.first().click();
      }
      // Always the first flavour, so one row carries the whole count.
      await expect(dialog.getByTestId('slot-meter')).toHaveAttribute('data-picked', String(target));
      await expect(dialog.getByTestId('slot-meter')).toContainText(`${total} of ${total}`);
      await expect(add).toBeEnabled();
      const count = await incs.count();
      for (let i = 0; i < count; i += 1) await expect(incs.nth(i)).toBeDisabled();
      if (target > 1) {
        await dialog.locator('[data-testid$="-dec"]').first().click();
        await expect(add).toBeDisabled();
      }
    });
  }

  test('credit chase names wrap instead of truncating', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await page.setViewportSize({ width: 360, height: 780 });
    const name = 'Client With Debt and a Very Long Surname Nakasujja';
    driver.mock.db.table('clients').find((r) => r.name === 'Client With Debt')!.name = name;
    await page.goto('/next/insights');
    await page.getByTestId('credit-toggle').click();
    const title = page.locator('[data-testid="insights-credit"] .credit__name', { hasText: 'Nakasujja' });
    await expect(title).toBeVisible();
    const box = await title.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        clipped: el.scrollWidth > el.clientWidth + 1,
        whiteSpace: style.whiteSpace,
        lines: Math.round(el.getBoundingClientRect().height / parseFloat(style.lineHeight)),
      };
    });
    expect(box.whiteSpace).toBe('normal');
    expect(box.clipped).toBe(false);
    expect(box.lines).toBeGreaterThan(1);
  });
});
