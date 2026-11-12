import { test } from '@playwright/test';

test('capture the sign-in page at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/next/auth.html');
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  await page.screenshot({ path: 'docs/overhaul/design-shots/after/auth.png', fullPage: true });
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByRole('heading', { name: 'Reset password' }).waitFor();
  await page.screenshot({ path: 'docs/overhaul/design-shots/after/auth-reset.png', fullPage: true });
});
