import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { createNextDriver } from './drivers/next';
import { setClock } from './helpers/clock';
import { installMockBackend } from '../mock';

const dir = process.env.V2C_SHOT_DIR || '/workspace/shots3';

test.describe('v2f shots at 390px', () => {
  test.beforeEach(async ({ page }) => {
    mkdirSync(dir, { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('Review sale carousel and toast', async ({ page }) => {
    test.setTimeout(120_000);
    await createNextDriver(page, { role: 'pos_staff' });
    await page.goto('/next/sell');

    // Pack carousel: a pack with three flavours.
    await page.getByTestId('product-commander').click();
    for (const f of ['mint', 'mint', 'grape', 'grape', 'strawberry']) await page.getByTestId(`config-flavor-${f}-inc`).click();
    await page.getByTestId('config-add').click();
    const sheet = page.getByRole('dialog', { name: 'Review sale' });
    await sheet.waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/v2f-pack-carousel-1.png` });
    const gallery = sheet.locator('[data-testid="line-gallery"][data-slides="3"]');
    await gallery.locator('[data-dot="1"]').click({ force: true });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${dir}/v2f-pack-carousel-2.png` });

    // Toast clear of the Review sale bar.
    await sheet.getByRole('button', { name: /^Remove/ }).first().click();
    await sheet.getByRole('button', { name: 'Close' }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/v2f-toast-above-cart-bar.png` });
  });

  test('clients storefront filter', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/clients');
    await page.getByTestId('client-filter-storefront').click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/v2f-clients-storefront.png` });
  });

  test('cookie partner history', async ({ page }) => {
    const cuts = [...Array.from({ length: 10 }, () => 25), 12];
    await installMockBackend(page, { role: 'pos_admin', partnerSettle: { qty: 262, batches: cuts } });
    await page.goto('/next/cookie-partner');
    await page.getByTestId('partner-history').waitFor();
    await page.getByTestId('partner-history-more').click();
    await page.getByTestId('partner-batch-toggle-11').click();
    await page.getByTestId('partner-hero').and(page.locator('[data-viewing="11"]')).waitFor();
    await page.waitForTimeout(400);
    await page.getByTestId('partner-history').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir}/v2f-cookie-partner-history.png` });
  });

  test('insights helper start day', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/insights');
    await page.getByTestId('money-chart').waitFor();
    // No helper yet: no split, no helper card, one quiet line.
    await page.getByTestId('helper-add').scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/v2f-insights-helper-unset.png` });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/v2f-insights-top-no-helper.png` });
    await page.getByTestId('helper-add').scrollIntoViewIfNeeded();
    await page.getByTestId('helper-add-open').click();
    await page.getByTestId('helper-since-input').fill('2026-11-05');
    await page.waitForTimeout(500);
    await page.getByTestId('commission-ledger').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir}/v2f-insights-helper-start-day.png` });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/v2f-insights-top-with-start-day.png` });
  });

  test('history collapsed and expanded', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/history');
    await page.locator('[data-testid^="history-day-toggle-"], [data-testid^="history-week-toggle-"]').first().waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/v2f-history-default.png` });
    const closed = page.locator('[data-testid^="history-week-toggle-"][aria-expanded="false"]');
    if (await closed.count()) await closed.first().click();
    await page.waitForTimeout(500);
    const day = page.locator('[data-testid^="history-day-toggle-"][aria-expanded="false"]');
    if (await day.count()) await day.first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/v2f-history-expanded.png` });
  });

  test('hours page', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/store');
    await page.getByTestId('hours-page').waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/v2f-hours.png` });
    await page.getByTestId('busy-30').click();
    await setClock(page, 'hours-open', '08:30');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/v2f-hours-busy-edited.png` });
  });
});
