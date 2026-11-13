import { expect, test, type Page } from '@playwright/test';
import { createNextDriver } from './drivers/next';

async function open(page: Page, tweak?: (d: Awaited<ReturnType<typeof createNextDriver>>) => void) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const driver = await createNextDriver(page, { role: 'pos_admin' });
  tweak?.(driver);
  await page.goto('/next/insights');
  await expect(page.getByTestId('insights-credit')).toBeVisible();
  return driver;
}

const payment = (clientId: unknown, amount: number) => ({
  id: `pay-${amount}`,
  client_id: clientId,
  amount_ugx: amount,
  method: 'cash',
  created_at: new Date().toISOString(),
});

test.describe('Insights: who owes me', () => {
  test('one collapsed card: total owed, people, collected, and one age bar', async ({ page }) => {
    await open(page, (d) => {
      const debtor = d.mock.db.table('clients').find((c) => c.name === 'Client With Debt')!;
      d.mock.db.table('credit_payments').push(payment(debtor.id, 5000));
    });
    await expect(page.getByTestId('credit-headline')).toHaveText('UGX 49,000 owed by 2 people · collected 5,000 this week');
    await expect(page.getByTestId('credit-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('credit-people')).toHaveCount(0);
    const bar = page.getByTestId('credit-age-bar');
    await expect(bar).toBeVisible();
    const parts = await bar.locator('[data-bucket]').evaluateAll((els) => els.map((e) => e.getAttribute('data-bucket')));
    expect(parts.length).toBeGreaterThanOrEqual(1);
    // The legend amounts add up to what is owed.
    const amounts = await page.locator('[data-testid^="credit-key-"]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-amount'))));
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(49000);
    // No per-person bars, and no "overdue" anywhere.
    await expect(page.getByText(/overdue/i)).toHaveCount(0);
  });

  test('collected follows the range', async ({ page }) => {
    await open(page, (d) => {
      const debtor = d.mock.db.table('clients').find((c) => c.name === 'Client With Debt')!;
      d.mock.db.table('credit_payments').push(payment(debtor.id, 5000));
    });
    await page.getByRole('button', { name: 'LW', exact: true }).click();
    await expect(page.getByTestId('credit-headline')).toHaveText('UGX 49,000 owed by 2 people');
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(page.getByTestId('credit-headline')).toContainText('collected 5,000 so far');
  });

  test('tap to open: one compact row per person, oldest first, with owed-age wording and chase buttons', async ({ page }) => {
    await open(page);
    await page.getByTestId('credit-toggle').click();
    await expect(page.getByTestId('credit-toggle')).toHaveAttribute('aria-expanded', 'true');
    const rows = page.locator('[data-testid^="credit-person-"]');
    await expect(rows).toHaveCount(2);
    for (const text of await rows.allInnerTexts()) expect(text).toMatch(/owed (today|\d+ days?|\d+ weeks)/);
    await expect(page.getByText(/overdue/i)).toHaveCount(0);

    // Test Client B has a number: WhatsApp opens wa.me with a polite reminder that carries the amount.
    const b = page.locator('[data-testid^="credit-person-"]', { hasText: 'Test Client B' });
    const key = (await b.getAttribute('data-testid'))!.replace('credit-person-', '');
    const href = (await page.getByTestId(`credit-whatsapp-${key}`).getAttribute('href'))!;
    expect(href.startsWith('https://wa.me/256772111222?text=')).toBe(true);
    const text = decodeURIComponent(href.split('?text=')[1]!);
    expect(text).toContain('Hello Test');
    expect(text).toContain('UGX 34,000');
    expect(text.toLowerCase()).not.toContain('overdue');
    await expect(page.getByTestId(`credit-whatsapp-${key}`)).toHaveAttribute('target', '_blank');

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByTestId(`credit-phone-${key}`).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('772111222');
  });

  test('tap a person for their orders with dates and balances', async ({ page }) => {
    await open(page);
    await page.getByTestId('credit-toggle').click();
    const b = page.locator('[data-testid^="credit-person-"]', { hasText: 'Test Client B' });
    await b.click();
    const key = (await b.getAttribute('data-testid'))!.replace('credit-person-', '');
    const orders = page.getByTestId(`credit-orders-${key}`).locator('[data-testid^="credit-order-"]');
    await expect(orders).toHaveCount(2);
    await expect(orders.first()).toContainText(/\d{1,2} \w{3}/);
    const balances = await orders.allInnerTexts();
    expect(balances.join(' ')).toContain('UGX 8,000');
    expect(balances.join(' ')).toContain('UGX 26,000');
    await expect(page.getByTestId(`credit-settle-all-${key}`)).toHaveText('Settle all UGX 34,000');
  });

  test('settle one order: amount plus a note, no cash / mobile money toggle, same writes as Clients', async ({ page }) => {
    const driver = await open(page);
    await page.getByTestId('credit-toggle').click();
    const b = page.locator('[data-testid^="credit-person-"]', { hasText: 'Test Client B' });
    await b.click();
    const small = page.locator('[data-testid^="credit-order-"]', { hasText: 'UGX 8,000' });
    await small.getByRole('button', { name: 'Settle' }).click();
    const sheet = page.getByTestId('credit-settle-sheet');
    await expect(sheet).toContainText('Owes');
    await expect(sheet).not.toContainText(/cash|mobile money/i);
    await expect(page.getByTestId('credit-settle-amount')).toHaveValue('8000');
    await page.getByRole('textbox', { name: 'Note' }).fill('Paid at the stall');
    await page.getByTestId('credit-settle-confirm').click();
    await expect(page.getByRole('status').filter({ hasText: 'Settled 8,000 UGX' })).toBeVisible();
    const patches = driver.mock.writes.filter((w) => w.method === 'PATCH' && w.url.includes('/rest/v1/sales'));
    expect(patches).toHaveLength(1);
    expect(patches[0]!.body).toMatchObject({ amount_paid_ugx: 8000, credit_cleared: true });
    const pay = driver.mock.writes.filter((w) => w.method === 'POST' && w.url.includes('/rest/v1/credit_payments'));
    expect(pay).toHaveLength(1);
    expect(pay[0]!.body).toMatchObject({ amount_ugx: 8000, method: 'cash', note: 'Paid at the stall' });
    await expect(page.getByTestId('credit-headline')).toContainText('UGX 41,000 owed by 2 people');
    await expect(page.getByTestId('credit-headline')).toContainText('collected 8,000');
  });

  test('settle the whole client, then everything: All settled', async ({ page }) => {
    const driver = await open(page);
    await page.getByTestId('credit-toggle').click();
    const b = page.locator('[data-testid^="credit-person-"]', { hasText: 'Test Client B' });
    await b.click();
    const key = (await b.getAttribute('data-testid'))!.replace('credit-person-', '');
    await page.getByTestId(`credit-settle-all-${key}`).click();
    await expect(page.getByTestId('credit-settle-amount')).toHaveValue('34000');
    // Part of it: the oldest sale goes first.
    await page.getByTestId('credit-settle-amount').fill('10000');
    await page.getByTestId('credit-settle-confirm').click();
    await expect(page.getByRole('status').filter({ hasText: 'Settled 10,000 UGX' })).toBeVisible();
    const sales = driver.mock.writes.filter((w) => w.method === 'PATCH' && w.url.includes('/rest/v1/sales'));
    expect(sales.length).toBe(2);
    await expect(page.getByTestId('credit-headline')).toContainText('UGX 39,000 owed by 2 people');

    // Clear the rest from the Clients page flow's twin: settle each person's whole balance here.
    for (const name of ['Test Client B', 'Client With Debt']) {
      const row = page.locator('[data-testid^="credit-person-"]', { hasText: name });
      if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
      const k = (await row.getAttribute('data-testid'))!.replace('credit-person-', '');
      const all = page.getByTestId(`credit-settle-all-${k}`);
      if (await all.count()) await all.click();
      else await page.locator(`[data-testid="credit-orders-${k}"] [data-testid^="credit-settle-order-"]`).first().click();
      await page.getByTestId('credit-settle-confirm').click();
      await expect(page.getByTestId('credit-settle-sheet')).toHaveCount(0);
    }
    await expect(page.getByTestId('credit-settled')).toContainText('All settled');
    await expect(page.getByTestId('credit-settled')).toContainText('collected 49,000');
    await expect(page.getByTestId('credit-toggle')).toHaveCount(0);
  });

  test('a failed settle says so and leaves the card as it was', async ({ page }) => {
    const driver = await open(page);
    await page.route('**/rest/v1/sales?id=eq.*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    });
    await page.getByTestId('credit-toggle').click();
    const b = page.locator('[data-testid^="credit-person-"]', { hasText: 'Client With Debt' });
    await b.click();
    await page.locator('[data-testid^="credit-settle-order-"]').first().click();
    await page.getByTestId('credit-settle-confirm').click();
    await expect(page.getByRole('status').filter({ hasText: 'Could not update sale (500)' })).toBeVisible();
    await expect(page.getByTestId('credit-headline')).toContainText('UGX 49,000 owed by 2 people');
    expect(driver.mock.writes.filter((w) => w.url.includes('credit_payments'))).toHaveLength(0);
  });
});
