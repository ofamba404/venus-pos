import { expect, test } from '@playwright/test';
import { setClock } from './helpers/clock';
import { createNextDriver } from './drivers/next';

test.describe('Hours & availability', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('says what the shop is doing right now, in words', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/store');
    const status = page.getByTestId('store-status');
    await expect(status).toHaveAttribute('data-state', /open|closed|busy/);
    await expect(status).toContainText(/Open now|Closed|Busy/);
    await expect(status).toContainText(/Closes at|Opens (today|tomorrow) at|Back to normal at/);
  });

  test('busy comes in 15 min, 30 min and 1 hour, and Clear busy only appears while busy', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/store');
    await expect(page.getByTestId('busy-clear')).toHaveCount(0);
    for (const id of ['busy-15', 'busy-30', 'busy-60']) await expect(page.getByTestId(id)).toBeVisible();
    await page.getByTestId('busy-60').click();
    await expect(page.getByTestId('store-status')).toHaveAttribute('data-state', 'busy');
    await expect(page.getByTestId('busy-clear')).toBeVisible();
    const last = () => driver.mock.writes.filter((w) => w.method === 'PATCH' && w.url.includes('store_fulfillment')).at(-1)!.body as { busy_until: string | null };
    const minutes = Math.round((new Date(last().busy_until!).getTime() - Date.now()) / 60000);
    expect(minutes).toBeGreaterThan(55);
    expect(minutes).toBeLessThanOrEqual(60);
    await page.getByTestId('busy-clear').click();
    await expect(page.getByTestId('busy-clear')).toHaveCount(0);
  });

  test('hours are tap-to-set time chips (no native time input), and Save lights up only when something changed', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/store');
    const open = page.getByTestId('hours-open');
    await expect(open.locator('xpath=self::input')).toHaveCount(0);
    await expect(page.locator('input[type="time"]')).toHaveCount(0);
    const save = page.getByTestId('hours-save');
    await expect(save).toBeDisabled();
    await expect(save).toHaveText('Saved');
    await setClock(page, 'hours-open', '08:30');
    await expect(save).toBeEnabled();
    await expect(save).toHaveText('Save hours');
    await expect(page.getByTestId('hours-preview')).toHaveCount(0);
    await expect(page.getByText('Clients see')).toHaveCount(0);
    await expect(page.getByTestId('hours-suggest-start')).toHaveCount(0);
    await save.click();
    await expect(page.getByTestId('hours-save')).toHaveText('Saved');
    const body = driver.mock.writes.filter((w) => w.method === 'PATCH' && w.url.includes('store_fulfillment')).at(-1)!.body as Record<string, string>;
    expect(body).toMatchObject({ open_time: '08:30' });
    expect(body).not.toHaveProperty('suggest_start');
    expect(body).not.toHaveProperty('suggest_end');
  });

  test('clearing an opening time cannot be saved', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/store');
    await setClock(page, 'hours-close', '');
    await expect(page.getByTestId('hours-save')).toBeDisabled();
  });

  test('it is named Hours in More', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/more');
    await expect(page.getByRole('button', { name: /^Hours/ }).or(page.getByRole('link', { name: /^Hours/ })).first()).toBeVisible();
  });
});
