import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

const dir = process.env.V2C_SHOT_DIR || '/workspace/shots3';

test.describe('sign in loader', () => {
  test.beforeEach(async ({ page }) => {
    mkdirSync(dir, { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('Sign in shows a spinner and is disabled while signing in', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await page.goto('/next/auth.html');
    await page.getByLabel('Email').fill('staff@test.local');
    await page.getByLabel('Password', { exact: true }).fill('correct horse');
    const button = page.getByRole('button', { name: 'Sign in' });
    const before = await button.boundingBox();
    driver.mock.setLatency(3000);
    await button.click();
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await expect(button.locator('.v-btn__spinner')).toBeVisible();
    await expect(button).toHaveText('Sign in');
    expect((await button.boundingBox())!.width).toBe(before!.width);
    await page.screenshot({ path: `${dir}/v2l-auth-loading.png` });
  });

  test('on an error the button comes back', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    driver.mock.setFailure({ method: 'POST', pathIncludes: '/auth/v1/token', status: 400, times: 1 });
    await page.goto('/next/auth.html');
    await page.getByLabel('Email').fill('staff@test.local');
    await page.getByLabel('Password', { exact: true }).fill('wrong');
    const button = page.getByRole('button', { name: 'Sign in' });
    await button.click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(button).toBeEnabled();
    await expect(button.locator('.v-btn__spinner')).toHaveCount(0);
  });
});
