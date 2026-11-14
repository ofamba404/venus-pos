import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createNextDriver } from './drivers/next';

const dir = '/workspace/shots3';

function seedStaffSales(driver: Awaited<ReturnType<typeof createNextDriver>>) {
  const clientId = String(driver.mock.db.table('clients')[0]?.id || '');
  driver.mock.db.table('sales').push({
    id: 'staff-sale-today',
    created_at: new Date().toISOString(),
    seller_id: 'test-user',
    client_id: clientId,
    total_ugx: 8000,
    is_credit: false,
    credit_cleared: false,
    amount_paid_ugx: 8000,
    items: [
      {
        product_id: 'scout',
        product_name: 'Scout Pack',
        detail: 'Mint',
        line_total: 8000,
        breakdown: { mint: 1 },
      },
    ],
  });
  driver.mock.db.table('staff_commission_summary').push({
    staff_id: 'test-user',
    rate: 0.4,
    earned_all: 8000,
    paid_all: 5000,
    pending_credit: 800,
    balance: 3000,
    last_paid_at: null,
  });
}

async function moreTitles(page: Page) {
  return page.locator('section .v-list-row__title').allTextContents();
}

async function boot(page: Page, role: 'pos_admin' | 'pos_staff') {
  await page.addInitScript(() => sessionStorage.setItem('venus-enforce-access', '1'));
  return createNextDriver(page, { role });
}

test.describe('staff and owner access', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('the Today tile opens Insights for staff and for the owner', async ({ page }) => {
    await boot(page, 'pos_staff');
    await page.goto('/next/sell');
    const tile = page.getByTestId('today-pill');
    await expect(tile).toHaveAttribute('aria-label', "Today's sales, open Insights");
    await tile.click();
    await expect(page.getByTestId('staff-insights')).toBeVisible();

    await boot(page, 'pos_admin');
    await page.goto('/next/sell');
    await page.getByTestId('today-pill').click();
    await expect(page.getByRole('heading', { name: 'Insights' })).toBeVisible();
    await expect(page.getByTestId('staff-insights')).toHaveCount(0);
    await expect(page.getByTestId('insights-commission')).toBeVisible();
  });

  test('staff More lists Clients, History and Insights, and hides owner-only pages', async ({ page }) => {
    await boot(page, 'pos_staff');
    await page.goto('/next/more');
    await page.getByRole('heading', { name: 'More' }).waitFor();
    await page.getByRole('button', { name: /^Settings/ }).waitFor();
    const titles = await moreTitles(page);
    expect(titles).toEqual(['Settings', 'Clients', 'History', 'Insights']);
    await expect(page.getByRole('button', { name: /^Hours/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Cookie partner/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Delivery/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Reviews/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^System/ })).toHaveCount(0);
    await page.goto('/next/store');
    await expect(page).toHaveURL(/\/next\/sell\/?$/);
    await page.goto('/next/cookie-partner');
    await expect(page).toHaveURL(/\/next\/sell\/?$/);
  });

  test('staff Insights shows only their sales and commission, not owner money', async ({ page }) => {
    const driver = await boot(page, 'pos_staff');
    seedStaffSales(driver);
    await page.goto('/next/insights');
    await expect(page.getByTestId('staff-insights')).toBeVisible();
    await expect(page.getByTestId('commission-earned')).toBeVisible();
    await expect(page.getByTestId('commission-paid')).toBeVisible();
    await expect(page.getByTestId('commission-pending')).toBeVisible();
    await expect(page.getByTestId('insights-restock')).toHaveCount(0);
    await expect(page.getByTestId('insights-credit')).toHaveCount(0);
    await expect(page.getByTestId('partner-summary')).toHaveCount(0);
    await expect(page.getByTestId('insights-rank')).toHaveCount(0);
    await expect(page.getByText('What do I owe?')).toHaveCount(0);
  });

  test('staff Clients can issue a reset code, and cannot delete or verify', async ({ page }) => {
    await boot(page, 'pos_staff');
    await page.goto('/next/clients');
    await page.getByTestId('client-filter-storefront').click();
    await page.getByRole('button', { name: /Buyer One/i }).first().click();
    await page.getByTestId('person-sheet').waitFor();
    await expect(page.getByTestId('store-user-reset')).toBeVisible();
    await expect(page.getByTestId('client-delete')).toHaveCount(0);
    await expect(page.getByTestId('store-user-delete')).toHaveCount(0);
    await expect(page.getByTestId('store-user-verify')).toHaveCount(0);
    await expect(page.getByTestId('settle-confirm')).toHaveCount(0);
    await page.getByTestId('store-user-reset').click();
    await expect(page.getByTestId('store-reset-code')).toBeVisible();
    await expect(page.getByTestId('copy-reset-code')).toBeVisible();
  });

  test('staff History shows only their own sales and is read-only', async ({ page }) => {
    const driver = await boot(page, 'pos_staff');
    seedStaffSales(driver);
    await page.goto('/next/history');
    await expect(page.getByTestId('history-sale-staff-sale-today')).toBeVisible();
    await expect(page.getByTestId('history-sale-staff-sale-today')).toContainText('Test Client A');
    await expect(page.getByTestId('history-sale-staff-sale-today')).toContainText('Scout Pack');
    await page.getByTestId('history-sale-staff-sale-today').click();
    await expect(page.getByRole('dialog', { name: 'Sale' })).toBeVisible();
    await expect(page.getByTestId('sale-edit')).toHaveCount(0);
    await expect(page.getByTestId('sale-void')).toHaveCount(0);
  });

  test('owner Insights is unchanged', async ({ page }) => {
    await boot(page, 'pos_admin');
    await page.goto('/next/insights');
    await expect(page.getByTestId('staff-insights')).toHaveCount(0);
    await expect(page.getByTestId('insights-commission')).toBeVisible();
    await expect(page.getByTestId('insights-restock')).toBeVisible();
    await expect(page.getByTestId('partner-summary')).toBeVisible();
  });
});

test('v2v screenshots at 390px', async ({ page }) => {
  test.setTimeout(90_000);
  mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });

  const staff = await boot(page, 'pos_staff');
  seedStaffSales(staff);

  await page.goto('/next/more');
  await page.getByRole('heading', { name: 'More' }).waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/v2v-staff-more.png` });

  await page.goto('/next/insights');
  await page.getByTestId('staff-insights').waitFor();
  await page.getByTestId('commission-earned').waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/v2v-staff-insights.png` });

  await page.goto('/next/clients');
  await page.getByTestId('client-filter-storefront').click();
  await page.getByRole('button', { name: /Buyer One/i }).first().click();
  await page.getByTestId('store-user-reset').click();
  await page.getByTestId('store-reset-code').waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/v2v-staff-clients-reset.png` });
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  await page.goto('/next/history');
  await page.getByTestId('history-sale-staff-sale-today').waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/v2v-staff-history.png` });

  await boot(page, 'pos_admin');
  await page.goto('/next/insights');
  await page.getByTestId('insights-commission').waitFor();
  await expect(page.getByTestId('staff-insights')).toHaveCount(0);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${dir}/v2v-owner-insights.png` });
});
