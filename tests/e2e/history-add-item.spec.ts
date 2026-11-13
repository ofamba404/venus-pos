import { expect, test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

async function openEdit(page: import('@playwright/test').Page) {
  await page.goto('/next/history');
  await page.getByTestId('history-sale-seed-sale-1').click();
  await page.getByTestId('sale-edit').click();
  await page.getByRole('dialog', { name: 'Edit sale' }).waitFor();
}

test.describe('History edit sale: Add item', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('Add item replaces Add Plain and opens the same product tiles as Sell', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await openEdit(page);
    const add = page.getByTestId('sale-edit-add');
    await expect(add).toHaveText('Add item');
    await expect(page.getByText('Add Plain')).toHaveCount(0);
    await add.click();
    const catalog = page.getByTestId('sale-add-catalog');
    for (const id of ['scout', 'pilot', 'commander', 'variety', 'cookie_duet', 'cookie_trio', 'plain_single', 'cookie_single']) {
      await expect(catalog.getByTestId(`product-${id}`)).toBeVisible();
    }
    for (const label of ['Packs', 'Singles', 'Wholesale']) await expect(catalog.getByText(label, { exact: true })).toBeVisible();
    // Back to the sale changes nothing.
    await page.getByTestId('sale-add-close').click();
    await expect(page.getByTestId('sale-edit-line-1')).toHaveCount(0);
  });

  test('add a Pilot pack with 2 flavours and a cookie to an existing sale, then save', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await openEdit(page);

    await page.getByTestId('sale-edit-add').click();
    await page.getByTestId('product-pilot').click();
    const picker = page.getByRole('dialog', { name: /Add · Pilot/ });
    const apply = picker.getByTestId('sale-add-apply');
    // The shared capped picker: exactly 2 flavours, and + stops at the cap.
    await expect(apply).toBeDisabled();
    await expect(apply).toContainText('Pick 2');
    await picker.getByTestId('config-flavor-mint-inc').click();
    await expect(apply).toBeDisabled();
    await picker.getByTestId('config-flavor-grape-inc').click();
    await expect(picker.getByTestId('slot-meter')).toContainText('2 of 2');
    await expect(picker.getByTestId('config-flavor-strawberry-inc')).toBeDisabled();
    await expect(apply).toBeEnabled();
    await apply.click();

    await expect(page.getByRole('dialog', { name: 'Edit sale' })).toBeVisible();
    await expect(page.getByTestId('sale-edit-line-1')).toContainText('Pilot Pack');
    await expect(page.getByTestId('sale-edit-total')).toContainText('23,000');

    await page.getByTestId('sale-edit-add').click();
    await page.getByTestId('product-cookie_single').click();
    const cookie = page.getByRole('dialog', { name: /Add · / });
    await cookie.getByTestId('config-flavor-cookie_chocolate-inc').click();
    await cookie.getByTestId('sale-add-apply').click();
    await expect(page.getByTestId('sale-edit-line-2')).toBeVisible();

    await page.getByTestId('sale-edit-save').click();
    await page.getByRole('status').filter({ hasText: /updated/i }).waitFor({ timeout: 8000 });

    const patch = driver.mock.writes
      .filter((w) => w.method === 'PATCH' && w.url.includes('/rest/v1/sales') && w.url.includes('seed-sale-1'))
      .at(-1)!.body as {
      total_ugx: number;
      amount_paid_ugx: number;
      items: Array<{ product_id: string; line_total: number; breakdown: Record<string, number> }>;
    };
    expect(patch.items.map((i) => i.product_id)).toEqual(['scout', 'pilot', 'cookie_single']);
    expect(patch.items[1]).toMatchObject({ line_total: 15000, breakdown: { mint: 1, grape: 1 } });
    expect(patch.items[2]!.breakdown).toEqual({ cookie_chocolate: 1 });
    const cookieTotal = patch.items[2]!.line_total;
    expect(cookieTotal).toBeGreaterThan(0);
    // Totals are recomputed the way Sell does, and a paid sale stays paid in full.
    expect(patch.total_ugx).toBe(8000 + 15000 + cookieTotal);
    expect(patch.amount_paid_ugx).toBe(patch.total_ugx);
    // Stock follows: one more mint and grape sold.
    const mintDeltas = driver.mock.writes
      .filter((w) => (w.body as { op?: string; category_id?: string } | null)?.category_id === 'grape')
      .map((w) => (w.body as { delta: number }).delta);
    expect(mintDeltas).toContain(-1);
  });

  test('the + on a pack adds another pack, so the flavour picker never opens over its cap', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    const sale = driver.mock.db.table('sales').find((r) => r.id === 'seed-sale-1')!;
    sale.items = [
      { product_id: 'pilot', product_name: 'Pilot Pack', detail: 'Mint x1, Grape x1', line_total: 15000, breakdown: { mint: 1, grape: 1 } },
    ];
    sale.total_ugx = 15000;
    sale.amount_paid_ugx = 15000;
    await openEdit(page);

    await page.getByTestId('sale-edit-inc').click();
    await expect(page.getByTestId('sale-edit-line-1')).toContainText('Pilot Pack');
    await expect(page.getByTestId('sale-edit-total')).toContainText('30,000');

    await page.getByTestId('sale-edit-flavours-0').click();
    const picker = page.getByRole('dialog', { name: /Flavours/ });
    // Still 1 mint + 1 grape: 2 of 2, full, Use these flavours is enabled and nothing can be added.
    await expect(picker.getByTestId('slot-meter')).toContainText('2 of 2');
    await expect(picker.getByTestId('sale-edit-flavours-apply')).toBeEnabled();
    await expect(picker.getByTestId('config-flavor-mint-inc')).toBeDisabled();
    await picker.getByTestId('sale-edit-flavours-back').click();

    await page.getByTestId('sale-edit-save').click();
    await page.getByRole('status').filter({ hasText: /updated/i }).waitFor({ timeout: 8000 });
    const patch = driver.mock.writes
      .filter((w) => w.method === 'PATCH' && w.url.includes('seed-sale-1'))
      .at(-1)!.body as { total_ugx: number; items: Array<{ breakdown: Record<string, number> }> };
    expect(patch.items).toHaveLength(2);
    expect(patch.items.every((i) => i.breakdown.mint === 1 && i.breakdown.grape === 1)).toBe(true);
    expect(patch.total_ugx).toBe(30000);
  });
});
