import { test, expect } from '@playwright/test';
import { createNextDriver } from './drivers/next';

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
});
