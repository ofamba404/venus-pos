import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { features } from '../../src/data/env';
import { createNextDriver } from './drivers/next';

const walkIn = JSON.parse(readFileSync('tests/e2e/goldens/D2-walk-in.next.json', 'utf8')) as {
  approvedChange: string;
  client_id: null;
};
const offline = JSON.parse(readFileSync('tests/e2e/goldens/D4-offline.next.json', 'utf8')) as {
  approvedChange: string;
  migration: string;
};
const hold = JSON.parse(readFileSync('tests/e2e/goldens/D6-hold.next.json', 'utf8')) as {
  approvedChange: string;
};

test('approved flags stay on and the client_sale_id migration is only a file', () => {
  expect(features.walkInClient).toBe(true);
  expect(features.holdSale).toBe(true);
  expect(features.offlineQueue).toBe(true);
  expect(features.paymentMethod).toBe(false);
  expect(offline.approvedChange).toMatch(/D4/);
  const sql = readFileSync(offline.migration, 'utf8');
  expect(sql).toMatch(/add column if not exists client_sale_id uuid/);
  expect(sql).toMatch(/Do not apply/);
});

test('the cart has no Walk-in chip', async ({ page }) => {
  expect(walkIn.approvedChange).toMatch(/D2/);
  await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/sell');
  await page.getByTestId('product-plain_single').click();
  await page.getByTestId('config-add').click();
  const review = page.getByRole('dialog', { name: 'Cart' });
  await expect(review.getByTestId('walk-in')).toHaveCount(0);
});

test('the cart has no Hold on this phone control', async ({ page }) => {
  expect(hold.approvedChange).toMatch(/D6/);
  await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/sell');
  await page.getByTestId('product-plain_single').click();
  await page.getByTestId('config-add').click();
  const review = page.getByRole('dialog', { name: 'Cart' });
  await review.waitFor();
  await expect(review.getByTestId('hold-sale')).toHaveCount(0);
  await expect(review.getByTestId('held-sales')).toHaveCount(0);
});
