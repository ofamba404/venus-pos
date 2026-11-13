import { expect, test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

test('Orders: two tabs (Waiting, Closed) with counts; accepted orders wait with a Confirmed tag; closed cards wear a status tag', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const driver = await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/orders');
  const rows = driver.mock.db.table('store_orders');
  const closed = (r: { status?: unknown }) => r.status === 'cancelled' || r.status === 'checked_out';
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.getByRole('tab', { name: /In sale/ })).toHaveCount(0);
  await expect(page.getByTestId('seg-count-waiting')).toHaveText(String(rows.filter((r) => !closed(r)).length));
  await expect(page.getByTestId('seg-count-closed')).toHaveText(String(rows.filter(closed).length));

  // An accepted order with no sale is still waiting, reads Confirmed, and opens the same sheet.
  const accepted = rows.find((r) => r.status === 'accepted')!;
  await expect(page.getByTestId(`confirmed-${accepted.id}`)).toBeVisible();
  await expect(page.getByTestId(`confirm-order-${accepted.id}`)).toHaveCount(0);
  await expect(page.getByTestId(`status-${accepted.id}`)).toHaveCount(0);
  await page.getByTestId(`view-order-${accepted.id}`).click();
  await expect(page.getByTestId('store-order-sheet')).toBeVisible();
  await expect(page.getByTestId('store-order-confirmed')).toBeVisible();
  await page.getByRole('dialog', { name: 'Store order' }).getByRole('button', { name: 'Close' }).click();

  await page.getByRole('tab', { name: /Closed/ }).click();
  const cancelled = rows.find((r) => r.status === 'cancelled');
  if (cancelled) {
    await expect(page.getByTestId(`status-${cancelled.id}`)).toHaveText('Cancelled');
    expect(await page.getByTestId(`status-${cancelled.id}`).evaluate((e) => e.className)).toContain('danger');
  }
  const done = rows.find((r) => r.status === 'checked_out');
  if (done) await expect(page.getByTestId(`status-${done.id}`)).toHaveText('Completed');
  // The raw status word is gone from the card.
  await expect(page.locator('.order-card .v-list-row__meta', { hasText: /^(accepted|cancelled|checked_out|pending)$/ })).toHaveCount(0);

  // Plain tap highlight is off app-wide.
  expect(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('-webkit-tap-highlight-color'))).toMatch(/transparent|rgba\(0, 0, 0, 0\)/);
});
