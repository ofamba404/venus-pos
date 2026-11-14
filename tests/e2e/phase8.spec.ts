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

test('a paid walk-in posts no client id', async ({ page }) => {
  expect(walkIn.approvedChange).toMatch(/D2/);
  const driver = await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/sell');
  await page.getByTestId('product-plain_single').click();
  await page.getByTestId('config-add').click();
  const review = page.getByRole('dialog', { name: 'Cart' });
  await review.getByTestId('walk-in').click();
  await review.getByTestId('charge').click();
  await page.getByText(/Sale recorded/).first().waitFor({ timeout: 10000 });
  const sale = driver.mock.writes.find(
    (row) => row.method === 'POST' && row.url.includes('/rest/v1/sales'),
  );
  expect(sale, 'walk-in sale POST').toBeTruthy();
  expect((sale?.body as { client_id?: unknown; is_credit?: boolean }).client_id).toBe(walkIn.client_id);
  expect((sale?.body as { is_credit?: boolean }).is_credit).toBe(false);
});

test('holding a sale keeps it on this phone and posts nothing', async ({ page }) => {
  expect(hold.approvedChange).toMatch(/D6/);
  const driver = await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/sell');
  await page.getByTestId('product-plain_single').click();
  await page.getByTestId('config-add').click();
  const review = page.getByRole('dialog', { name: 'Cart' });
  await review.getByTestId('hold-sale').click();
  await page.getByRole('status').filter({ hasText: /held/i }).waitFor();
  const sheet = page.getByRole('dialog', { name: 'Cart' });
  await sheet.getByTestId('held-sales').getByRole('button').click();
  await expect(sheet.getByText('Plain').first()).toBeVisible();
  expect(driver.mock.writes.some((row) => row.method === 'POST' && row.url.includes('/rest/v1/sales'))).toBe(
    false,
  );
});
