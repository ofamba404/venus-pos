import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

const dir = process.env.V2C_SHOT_DIR || '/workspace/shots3';

test('v2g: Sell pack tile carousel at 390px', async ({ page }) => {
  mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/sell');
  const add = async (id: string, flavours: string[]) => {
    await page.getByTestId(`product-${id}`).click();
    for (const f of flavours) await page.getByTestId(`config-flavor-${f}-inc`).click();
    await page.getByTestId('config-add').click();
    const sheet = page.getByRole('dialog', { name: 'Review sale' });
    await sheet.waitFor();
    await sheet.getByRole('button', { name: 'Close' }).click();
    await sheet.waitFor({ state: 'hidden' });
  };
  await add('pilot', ['mint', 'grape']);
  await add('commander', ['watermelon', 'watermelon', 'blueberry', 'strawberry', 'strawberry']);
  await page.getByTestId('product-pilot').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.querySelector('.tile-grid')!.getBoundingClientRect().top + window.scrollY - 70));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/v2g-sell-pack-carousel-1.png` });
  for (const id of ['pilot', 'commander']) {
    await page.getByTestId(`product-${id}`).getByTestId('gallery-track').evaluate((el) => el.scrollTo({ left: el.clientWidth, behavior: 'auto' }));
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${dir}/v2g-sell-pack-carousel-2.png` });
});
