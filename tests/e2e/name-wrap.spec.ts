import { test, expect, type Locator, type Page } from '@playwright/test';
import { createNextDriver } from './drivers/next';

const LONG = 'Bartholomew Nakimuli Wolfeschlegelstein';

/** True when any word of the element's text is split across two lines. */
async function brokenWords(el: Locator): Promise<string[]> {
  return el.evaluate((root) => {
    const broken: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent || '';
      for (const match of text.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index!);
        range.setEnd(node, match.index! + match[0].length);
        const tops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
        if (tops.size > 1) broken.push(match[0]);
      }
    }
    return broken;
  });
}

async function expectWhole(page: Page, el: Locator) {
  await expect(el).toBeVisible();
  expect(await brokenWords(el)).toEqual([]);
  const style = await el.evaluate((node) => {
    const s = getComputedStyle(node);
    return { whiteSpace: s.whiteSpace, textOverflow: s.textOverflow, wrap: s.overflowWrap, clipped: node.scrollWidth > node.clientWidth + 1 };
  });
  expect(style.whiteSpace).toBe('normal');
  expect(style.textOverflow).not.toBe('ellipsis');
  expect(style.wrap).not.toBe('anywhere');
  expect(style.clipped).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
}

for (const width of [360, 390]) {
  test.describe(`long names at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
    });

    test('Orders card: the name wraps at spaces, and the amount drops below when tight', async ({ page }) => {
      const driver = await createNextDriver(page, { role: 'pos_admin' });
      driver.mock.db.table('store_orders').find((r) => r.id === 'so-confirmed-1')!.customer_name = LONG;
      await page.goto('/next/orders');
      const title = page.locator('.order-card__who .v-list-row__title', { hasText: 'Wolfeschlegelstein' });
      await expectWhole(page, title);
      const card = page.locator('article.v-order-card', { has: title });
      const amount = card.locator('.order-card__headline > .v-money');
      const name = await title.boundingBox();
      const money = await amount.boundingBox();
      const cardBox = await card.boundingBox();
      // The name has the card's width less its padding and thumbnail, not a squeezed sliver.
      expect(name!.width).toBeGreaterThan(150);
      // The amount is either beside the name or wholly below it, never overlapping.
      expect(money!.y >= name!.y + name!.height - 1 || money!.x >= name!.x + name!.width - 1).toBe(true);
      expect(money!.x + money!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width);
    });

    test('loaded-order card and the checkout header', async ({ page }) => {
      const driver = await createNextDriver(page, { role: 'pos_admin' });
      driver.mock.db.table('store_orders').find((r) => r.id === 'so-confirmed-1')!.customer_name = LONG;
      driver.mock.db.table('store_orders').find((r) => r.id === 'so-confirmed-1')!.items = [
        { product_id: 'scout', product_name: 'Scout Pack', line_total: 8000, breakdown: { strawberry: 1 } },
      ];
      await page.goto('/next/orders');
      await page.getByTestId('load-order-so-confirmed-1').click();
      await page.waitForURL(/\/sell/);
      await expectWhole(page, page.getByTestId('loaded-order-name'));
      await page.getByTestId('cart-bar').click();
      await expectWhole(page, page.getByRole('dialog', { name: 'Review sale' }).getByTestId('loaded-order-cart-name'));
    });

    test('chase list: the name keeps the row and the buttons drop below', async ({ page }) => {
      const driver = await createNextDriver(page, { role: 'pos_admin' });
      driver.mock.db.table('clients').find((r) => r.name === 'Client With Debt')!.name = LONG;
      await page.goto('/next/insights');
      await page.getByTestId('credit-toggle').click();
      const title = page.locator('[data-testid="insights-credit"] .credit__name', { hasText: 'Wolfeschlegelstein' });
      await expectWhole(page, title);
    });

    test('history row and clients list', async ({ page }) => {
      const driver = await createNextDriver(page, { role: 'pos_admin' });
      const clients = driver.mock.db.table('clients');
      clients.find((r) => r.name === 'Test Client A')!.name = LONG;
      await page.goto('/next/history');
      const row = page.locator('[data-testid^="history-sale-"] .v-list-row__title', { hasText: 'Wolfeschlegelstein' }).first();
      await expectWhole(page, row);
      await page.goto('/next/clients');
      const card = page.locator('.client-card__text .v-list-row__title', { hasText: 'Wolfeschlegelstein' }).first();
      await expectWhole(page, card);
    });

    test('a single word wider than the card still breaks as a last resort, without overflowing', async ({ page }) => {
      const driver = await createNextDriver(page, { role: 'pos_admin' });
      driver.mock.db.table('store_orders').find((r) => r.id === 'so-confirmed-1')!.customer_name = 'W'.repeat(60);
      await page.goto('/next/orders');
      const title = page.locator('.order-card__who .v-list-row__title', { hasText: 'WWWW' });
      await expect(title).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    });
  });
}
