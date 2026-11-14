import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { createNextDriver } from './drivers/next';
import { openSale } from './helpers/history';

const dir = process.env.SHOT_DIR || 'docs/overhaul/design-shots/after';

test('capture 390px screens', async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const driver = await createNextDriver(page, { role: 'pos_admin' });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  // A long name and a phone on a sale, so the wrap and the copy buttons show.
  driver.mock.db.table('store_orders').find((r) => r.id === 'so-confirmed-1')!.customer_name =
    'Bartholomew Nakimuli Wolfeschlegelstein';
  const seedSale = driver.mock.db.table('sales').find((r) => r.id === 'seed-sale-1')!;
  seedSale.client_phone = '0700333444';
  seedSale.location_label = 'Kololo';
  // A long client name in the chase list, so the wrap shows there too.
  driver.mock.db.table('clients').find((r) => r.name === 'Client With Debt')!.name =
    'Client With Debt and a Very Long Surname Nakasujja';

  async function frame() {
    await page.addStyleTag({
      content: '.shell__nav{display:none!important}.shell__main{padding-bottom:24px!important}',
    });
  }

  async function shot(name: string, path: string, ready: string) {
    await page.goto(path);
    await page.locator(ready).first().waitFor({ timeout: 20_000 });
    await frame();
    await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
  }

  await shot('sell', '/next/sell', '[data-testid="product-scout"]');
  // A pack holds to its joint count: Pilot is 2, so one pick leaves the add button waiting.
  await page.getByTestId('product-pilot').click();
  await page.getByTestId('config-flavor-mint-inc').click();
  await page.waitForTimeout(400);
  await frame();
  await page.screenshot({ path: `${dir}/sell-picker-pilot.png` });
  await page.getByRole('dialog').last().getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('product-plain_single').click();
  await page.getByTestId('config-add').click();
  await page.getByRole('dialog', { name: 'Cart' }).waitFor();
  await page.getByRole('dialog', { name: 'Cart' }).getByRole('tab', { name: 'Delivery' }).click();
  await page.getByRole('dialog', { name: 'Cart' }).getByTestId('delivery-phone').fill('+256700111222');
  await frame();
  // The sheet is fixed to the screen, so shoot the viewport with the copy buttons scrolled into it.
  await page
    .getByRole('dialog', { name: 'Cart' })
    .getByTestId('copy-phone')
    .evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: `${dir}/review-sheet.png` });
  await page.keyboard.press('Escape');

  await shot('orders', '/next/orders', 'h1');
  await shot('history', '/next/history', 'h1');
  await openSale(page, 'seed-sale-1');
  await page.getByRole('dialog', { name: 'Sale' }).waitFor();
  await frame();
  await page.screenshot({ path: `${dir}/sale-sheet.png` });
  await page.getByTestId('sale-edit').click();
  await page.getByRole('dialog', { name: 'Edit sale' }).waitFor();
  await frame();
  await page.screenshot({ path: `${dir}/edit-sale.png` });
  await page.getByTestId('sale-edit-flavours-0').click();
  await page.getByRole('dialog', { name: /Flavours/ }).waitFor();
  await page.getByTestId('config-flavor-mint-dec').click();
  await page.getByTestId('config-flavor-strawberry-inc').click();
  await page.waitForTimeout(400);
  await frame();
  await page.screenshot({ path: `${dir}/edit-sale-flavours.png` });
  await page.keyboard.press('Escape');
  await page.getByTestId('sale-edit-flavours-back').click();
  await page.keyboard.press('Escape');
  await shot('clients', '/next/clients', 'h1');
  await shot('insights', '/next/insights', 'h1');
  await shot('reviews', '/next/reviews', '.v-review');
  await shot('stock', '/next/stock', '[data-testid="stock-glance"]');
  await shot('more', '/next/more', 'h1');

  // Stock as staff: read-only. A second page, signed in as staff.
  const staffContext = await browser.newContext({
    baseURL,
    locale: 'en-UG',
    timezoneId: 'Africa/Kampala',
    serviceWorkers: 'block',
  });
  const staffPage = await staffContext.newPage();
  await staffPage.setViewportSize({ width: 390, height: 844 });
  await createNextDriver(staffPage, { role: 'pos_staff' });
  await staffPage.goto('/next/stock');
  await staffPage.locator('[data-testid="stock-readonly"]').waitFor({ timeout: 20_000 });
  await staffPage.addStyleTag({
    content: '.shell__nav{display:none!important}.shell__main{padding-bottom:24px!important}',
  });
  await staffPage.screenshot({ path: `${dir}/stock-staff.png`, fullPage: true });
  await staffContext.close();
});
