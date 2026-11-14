import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { setClock } from './helpers/clock';
import { createNextDriver } from './drivers/next';

const dir = '/workspace/shots3';

test('v2u screenshots at 390px', async ({ page }) => {
  test.setTimeout(90_000);
  mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await createNextDriver(page, { role: 'pos_admin' });

  await page.goto('/next/sell');
  await page.getByTestId('today-pill').waitFor();
  const status = page.getByTestId('store-status-btn');
  await expect(status).toHaveAttribute('data-state', 'open');
  await expect(status).toHaveText(/^Open$/i);
  await page.waitForTimeout(250);
  await page.locator('.sell-today').screenshot({ path: `${dir}/v2u-sell-top-open.png` });

  await status.click();
  await page.getByRole('dialog', { name: 'Hours' }).waitFor();
  await expect(page.getByTestId('hours-suggest-start')).toHaveCount(0);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${dir}/v2u-hours-sheet.png` });
  await page.getByRole('dialog', { name: 'Hours' }).getByRole('button', { name: 'Close' }).click();
  await page.getByRole('dialog', { name: 'Hours' }).waitFor({ state: 'hidden' });

  await page.getByTestId('product-plain_single').click();
  await page.getByTestId('config-add').click();
  const cart = page.getByRole('dialog', { name: 'Cart' });
  await cart.waitFor();
  await cart.getByTestId('cart-client').fill('Test Cli');
  await cart.getByTestId('client-chips').locator('strong').first().waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${dir}/v2u-cart-client-chips.png` });
  await cart.getByRole('button', { name: 'Close' }).click();
  await cart.waitFor({ state: 'hidden' });

  await expect(page.getByTestId('review-bar')).toBeVisible();
  await expect(page.getByTestId('cart-bar')).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/v2u-sell-bars.png` });

  await status.click();
  await page.getByRole('dialog', { name: 'Hours' }).waitFor();
  await page.getByTestId('busy-15').click();
  await expect(page.getByTestId('store-status')).toHaveAttribute('data-state', 'busy');
  await page.getByRole('dialog', { name: 'Hours' }).getByRole('button', { name: 'Close' }).click();
  await page.getByRole('dialog', { name: 'Hours' }).waitFor({ state: 'hidden' });
  await expect(status).toHaveAttribute('data-state', 'busy');
  await expect(status).toHaveText(/^Busy$/i);
  await page.waitForTimeout(200);
  await page.locator('.sell-today').screenshot({ path: `${dir}/v2u-sell-top-busy.png` });

  await status.click();
  await page.getByRole('dialog', { name: 'Hours' }).waitFor();
  await page.getByTestId('busy-clear').click();
  await expect(page.getByTestId('busy-clear')).toHaveCount(0);
  await setClock(page, 'hours-open', '22:00');
  await setClock(page, 'hours-close', '23:00');
  await page.getByTestId('hours-save').click();
  await expect(page.getByTestId('hours-save')).toHaveText('Saved');
  await page.getByRole('dialog', { name: 'Hours' }).getByRole('button', { name: 'Close' }).click();
  await page.getByRole('dialog', { name: 'Hours' }).waitFor({ state: 'hidden' });
  await expect(status).toHaveAttribute('data-state', 'closed');
  await expect(status).toHaveText(/^Closed$/i);
  await page.waitForTimeout(200);
  await page.locator('.sell-today').screenshot({ path: `${dir}/v2u-sell-top-closed.png` });

  execFileSync('python3', ['tests/e2e/helpers/stitch-sell-top.py']);
});
