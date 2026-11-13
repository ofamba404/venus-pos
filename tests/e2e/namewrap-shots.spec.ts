import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

const dir = process.env.NAMEWRAP_SHOT_DIR || '/workspace/shots3';
const LONG = 'Bartholomew Nakimuli Wolfeschlegelstein';

for (const width of [390, 360]) {
  test(`capture long names at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    mkdirSync(dir, { recursive: true });
    await page.setViewportSize({ width, height: 844 });
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    const order = driver.mock.db.table('store_orders').find((r) => r.id === 'so-confirmed-1')!;
    order.customer_name = LONG;
    order.items = [{ product_id: 'scout', product_name: 'Scout Pack', line_total: 8000, breakdown: { strawberry: 1 } }];
    driver.mock.db.table('clients').find((r) => r.name === 'Client With Debt')!.name = LONG;
    driver.mock.db.table('clients').find((r) => r.name === 'Test Client A')!.name = LONG;
    const hideNav = () => page.addStyleTag({ content: '.shell__nav{display:none!important}' });

    await page.goto('/next/orders');
    await page.getByTestId('view-order-so-confirmed-1').waitFor({ timeout: 20_000 });
    await page.waitForTimeout(500);
    await hideNav();
    await page.locator('article.v-order-card', { hasText: 'Wolfeschlegelstein' }).first().screenshot({ path: `${dir}/namewrap-orders-card-${width}.png` });

    await page.goto('/next/insights');
    await page.locator('[data-testid="insights-credit"]').waitFor();
    await page.getByTestId('credit-toggle').click();
    await page.waitForTimeout(500);
    await hideNav();
    await page.locator('[data-testid="insights-credit"]').screenshot({ path: `${dir}/namewrap-chase-list-${width}.png` });

    await page.goto('/next/history');
    await page.locator('[data-testid^="history-sale-"]').first().waitFor();
    await page.waitForTimeout(500);
    await hideNav();
    await page.screenshot({ path: `${dir}/namewrap-history-${width}.png` });

    await page.goto('/next/clients');
    await page.locator('.client-card').first().waitFor();
    await page.waitForTimeout(500);
    await hideNav();
    await page.screenshot({ path: `${dir}/namewrap-clients-${width}.png` });

    await page.goto('/next/orders');
    await page.getByTestId('view-order-so-confirmed-1').click();
    await page.getByTestId('store-order-sheet').waitFor();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${dir}/namewrap-order-sheet-${width}.png` });
  });
}
