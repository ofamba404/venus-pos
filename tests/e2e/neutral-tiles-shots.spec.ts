import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

const dir = process.env.NEUTRAL_SHOT_DIR || '/workspace/shots3';
const tag = process.env.NEUTRAL_SHOT_TAG || 'neutral-tiles-sell';

for (const width of [390, 360]) {
  test(`capture Sell product tiles at ${width}px`, async ({ page }) => {
    mkdirSync(dir, { recursive: true });
    await page.setViewportSize({ width, height: 844 });
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/sell');
    await page.getByTestId('product-scout').waitFor({ timeout: 20_000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(600);
    await page.addStyleTag({ content: '.shell__nav{display:none!important}' });
    await page.screenshot({ path: `${dir}/${tag}-${width}.png`, fullPage: true });
  });
}
