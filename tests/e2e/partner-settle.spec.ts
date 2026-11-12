import { expect, test } from '@playwright/test';
import { installMockBackend } from '../mock';

const REAL_CUTS = [...Array.from({ length: 10 }, () => 25), 12];

test('insights shows the live settled cookie batches, not the first three', async ({ page }) => {
  await installMockBackend(page, {
    role: 'pos_admin',
    partnerSettle: { qty: 262, batches: REAL_CUTS },
  });
  await page.goto('/next/insights');
  await expect(page.getByTestId('partner-settled-qty')).toHaveText(/262 cookies already settled/);
  await expect(page.getByTestId('partner-settle')).toHaveCount(0);
  await expect(page.getByText('Batch 1 · 25/25')).toBeVisible();
  await expect(page.getByText('Settled').first()).toBeVisible();
});
