import { mkdirSync } from 'node:fs';
import { test, type Page } from '@playwright/test';
import { installMockBackend } from '../mock';
import { buildDefaultSeed } from '../fixtures/seed';
import { expandPartnerUnitsFromSales } from '../../src/domain/partner';
import { settledCutsFor } from '../../src/domain/partner-send';

const dir = process.env.V2C_SHOT_DIR || '/workspace/shots3';
const TOTAL = expandPartnerUnitsFromSales(buildDefaultSeed().sales as Parameters<typeof expandPartnerUnitsFromSales>[0]).length;

async function boot(page: Page, openCount: number) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = '.v-toast-host{display:none!important}';
      document.head.appendChild(st);
    });
  });
  // A history like the live one: whole batches and a part batch, then the open cookies.
  const qty = TOTAL - openCount;
  await installMockBackend(page, { role: 'pos_admin', partnerSettle: { qty, batches: settledCutsFor(qty, null) } });
}

test('v2c: cookie partner page, partial send flow', async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(dir, { recursive: true });
  await boot(page, 6);
  await page.goto('/next/insights');
  const tile = page.getByTestId('partner-summary');
  await tile.waitFor();
  await tile.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/v2c-cookie-partner-insights-tile.png` });
  await page.goto('/next/cookie-partner');
  await page.getByTestId('partner-settle').waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/v2c-cookie-partner.png` });
  await page.screenshot({ path: `${dir}/v2c-cookie-partner-full.png`, fullPage: true });
  await page.getByTestId('partner-settle').click();
  await page.getByTestId('partner-confirm').waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${dir}/v2c-cookie-partner-confirm.png` });
  await page.getByTestId('partner-confirm-send').click();
  await page.getByTestId('partner-batch-2').waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${dir}/v2c-cookie-partner-sent.png` });
  await page.goto('/next/more');
  await page.getByRole('button', { name: 'Cookie partner' }).waitFor();
  await page.screenshot({ path: `${dir}/v2c-cookie-partner-more.png` });
});

test('v2c: cookie partner page, a full batch waiting', async ({ page }) => {
  await boot(page, 52);
  await page.goto('/next/cookie-partner');
  await page.getByTestId('partner-settle').waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/v2c-cookie-partner-full-batch.png` });
});
