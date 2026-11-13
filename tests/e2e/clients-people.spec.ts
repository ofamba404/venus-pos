import { expect, test, type Page } from '@playwright/test';
import { createNextDriver } from './drivers/next';

type Driver = Awaited<ReturnType<typeof createNextDriver>>;

/** Client With Debt has phone 0700333444 in the seed. This account shares it as +256 700 333 444. */
function addMergedAccount(driver: Driver) {
  driver.mock.db.table('store_accounts').push({
    id: 'acc-debt',
    phone: '+256700333444',
    pos_display_name: 'Debt Storefront',
    verified: true,
  });
}

async function openPerson(page: Page, name: string) {
  await page.getByRole('button', { name: new RegExp(name, 'i') }).first().click();
  await page.getByTestId('person-sheet').waitFor();
}

test.describe('one Clients list for POS clients and storefront accounts', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('filter chips: All, Walk-in, Storefront, Owes money, with counts', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    addMergedAccount(driver);
    await page.goto('/next/clients');
    await page.getByTestId('client-list').getByRole('button').first().waitFor();
    const tabs = page.getByTestId('client-filters').getByRole('tab');
    await expect(tabs).toHaveText([/^All\d+$/, /^Walk-in\d+$/, /^Storefront\d+$/, /^Owes money\d+$/]);

    const count = async (id: string) => Number(((await page.getByTestId(`client-filter-${id}`).innerText()).match(/\d+$/) || ['0'])[0]);
    // 12 POS clients + 2 default store-only accounts (the third account is joined to Client With Debt).
    expect(await count('all')).toBe(12 + 2);
    expect(await count('storefront')).toBe(3);
    expect(await count('walkin')).toBe(11);
    expect(await count('owes')).toBe(2);

    await page.getByTestId('client-filter-storefront').click();
    await expect(page.getByTestId('client-filter-storefront')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('client-list').locator('.client-card')).toHaveCount(3);
    await expect(page.getByTestId('storefront-tag')).toHaveCount(3);

    await page.getByTestId('client-filter-owes').click();
    await expect(page.getByTestId('client-list').locator('.client-card')).toHaveCount(2);
    await expect(page.getByTestId('owed-tag')).toHaveCount(2);

    await page.getByTestId('client-filter-walkin').click();
    await expect(page.getByTestId('storefront-tag')).toHaveCount(0);
    await expect(page.getByTestId('client-list')).not.toContainText('Buyer One');
  });

  test('a POS client and a store account with the same 9-digit phone are ONE person with both action sets', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    addMergedAccount(driver);
    await page.goto('/next/clients');
    await page.getByTestId('client-list').getByRole('button').first().waitFor();
    // One row, not two: the debt client carries the Storefront tag and the account has no row of its own.
    await expect(page.getByTestId('client-list').getByText('Client With Debt')).toHaveCount(1);
    await expect(page.getByTestId('client-list').getByText('Debt Storefront')).toHaveCount(0);
    const row = page.getByTestId('client-list').locator('.client-card', { hasText: 'Client With Debt' });
    await expect(row.getByTestId('storefront-tag')).toBeVisible();

    await openPerson(page, 'Client With Debt');
    const sheet = page.getByTestId('person-sheet');
    await expect(sheet).toHaveAttribute('data-kind', 'both');
    // POS side: settle, rename, delete.
    for (const id of ['settle-amount', 'settle-confirm', 'client-edit-name', 'client-rename', 'client-delete']) {
      await expect(sheet.getByTestId(id)).toBeVisible();
    }
    // Storefront side: display name, reset code, delete. Verified already, so no Verify.
    for (const id of ['store-user-name', 'store-user-save', 'store-user-reset', 'store-user-delete']) {
      await expect(sheet.getByTestId(id)).toBeVisible();
    }
    await expect(sheet.getByTestId('store-user-verify')).toHaveCount(0);
  });

  test('a store-only person gets the storefront actions: verify, display name, reset code, delete', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/clients');
    await page.getByTestId('client-filter-storefront').click();
    await page.getByTestId('person-acc-2').getByRole('button').click();
    const sheet = page.getByTestId('person-sheet');
    await expect(sheet).toHaveAttribute('data-kind', 'account');
    await expect(sheet.getByTestId('section-client')).toHaveCount(0);
    await expect(sheet.getByTestId('settle-confirm')).toHaveCount(0);

    await sheet.getByTestId('store-user-name').fill('Counter 1');
    await sheet.getByTestId('store-user-save').click();
    await page.getByRole('status').filter({ hasText: 'Name saved' }).waitFor();
    await sheet.getByTestId('store-user-verify').click();
    await page.getByRole('status').filter({ hasText: 'User verified' }).waitFor();
    await sheet.getByTestId('store-user-reset').click();
    await expect(sheet.getByTestId('store-reset-code')).toContainText('ABCD-2345');

    const patches = driver.mock.writes.filter((w) => w.method === 'PATCH' && w.url.includes('store_accounts'));
    expect(patches.map((w) => w.body)).toEqual([{ pos_display_name: 'Counter 1' }, { verified: true }]);
    expect(patches.every((w) => w.url.includes('acc-2'))).toBe(true);
  });

  test('deleting asks first, for a client and for a store account', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/clients');
    await page.getByTestId('client-add-name').fill('Temp Client');
    await page.getByTestId('client-add').click();
    await openPerson(page, 'Temp Client');
    await page.getByTestId('client-delete').click();
    await expect(page.getByTestId('client-delete-confirm')).toBeVisible();
    expect(driver.mock.writes.filter((w) => w.method === 'DELETE')).toHaveLength(0);
    await page.getByTestId('client-delete-cancel').click();
    await expect(page.getByTestId('client-delete')).toBeVisible();
    await page.getByTestId('client-delete').click();
    await page.getByTestId('client-delete-confirm').click();
    await page.getByRole('status').filter({ hasText: 'Client deleted' }).waitFor();
    expect(driver.mock.writes.filter((w) => w.method === 'DELETE' && w.url.includes('/clients'))).toHaveLength(1);

    await page.getByTestId('client-filter-storefront').click();
    await page.getByTestId('person-acc-2').getByRole('button').click();
    await page.getByTestId('store-user-delete').click();
    expect(driver.mock.writes.filter((w) => w.method === 'DELETE' && w.url.includes('store_accounts'))).toHaveLength(0);
    await page.getByTestId('store-user-delete-confirm').click();
    await page.getByRole('status').filter({ hasText: 'User deleted' }).waitFor();
    expect(driver.mock.writes.filter((w) => w.method === 'DELETE' && w.url.includes('store_accounts'))).toHaveLength(1);
  });

  test('loads ALL storefront accounts, not just 20', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    const table = driver.mock.db.table('store_accounts');
    for (let i = 0; i < 245; i += 1) {
      table.push({ id: `bulk-${String(i).padStart(3, '0')}`, phone: `07555${String(i).padStart(5, '0')}`, pos_display_name: `Bulk ${i}`, verified: true });
    }
    await page.goto('/next/clients');
    await page.getByTestId('client-list').getByRole('button').first().waitFor();
    await expect(page.getByTestId('client-filter-storefront')).toHaveText(/247$/);
    // Fetched in pages of 200, not capped at 20.
    await expect.poll(() => driver.mock.requests.filter((r) => r.method === 'GET' && r.url.includes('store_accounts')).length).toBeGreaterThanOrEqual(2);
    // The list shows a page of people with a Show more button, not 250 rows in an inner scroller.
    await page.getByTestId('client-filter-storefront').click();
    await expect(page.getByTestId('client-show-more')).toBeVisible();
    await page.getByTestId('client-show-more').click();
    expect(await page.getByTestId('client-list').locator('.client-card').count()).toBeGreaterThan(60);
  });

  test('the Store page no longer lists storefront users', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/store');
    await expect(page.getByTestId('store-user-list')).toHaveCount(0);
    await expect(page.getByTestId('store-user-name')).toHaveCount(0);
    await expect(page.getByTestId('store-users-moved')).toBeVisible();
    await page.getByTestId('store-users-open-clients').click();
    await page.waitForURL(/\/clients/);
  });
});

test.describe('Clients visuals', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('the owed tag sits on the right like Clear, avatars are bronze, copy is friendly, no inner scroller', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/clients');
    const list = page.getByTestId('client-list');
    await list.getByRole('button').first().waitFor();
    const owed = list.getByTestId('owed-tag').first();
    const clear = list.locator('.client-card__status .v-tag', { hasText: 'Clear' }).first();
    const right = async (loc: typeof owed) => {
      const b = (await loc.boundingBox())!;
      return Math.round(b.x + b.width);
    };
    expect(Math.abs((await right(owed)) - (await right(clear)))).toBeLessThanOrEqual(2);
    // Debt rows are the same height class as clear rows: the tag does not wrap under the name.
    const cardOwed = (await list.locator('.client-card').filter({ has: page.getByTestId('owed-tag') }).first().boundingBox())!;
    expect(cardOwed.height).toBeLessThan(90);

    // Calmer tag: still red text, but a faint wash and a thin outline rather than the old solid block.
    const tag = await owed.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { color: cs.color, bg: cs.backgroundColor, weight: getComputedStyle(el.querySelector('.v-money')!).fontWeight };
    });
    expect(tag.color).toBe('rgb(156, 15, 15)');
    expect(Number(tag.weight)).toBeLessThanOrEqual(500);

    const avatar = await list.locator('.v-avatar').first().evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
    expect(avatar).toEqual({ bg: 'rgb(232, 220, 200)', color: 'rgb(110, 84, 44)' });

    const text = await list.innerText();
    expect(text).not.toContain('No orders yet');
    expect(text).toContain('No sales yet');
    expect(text).toMatch(/Last bought \d{1,2} \w{3}/);

    // The page scrolls, the list does not.
    const overflowY = await list.evaluate((el) => getComputedStyle(el).overflowY);
    expect(overflowY).toBe('visible');
    expect(await list.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    // Space under Copy names.
    const copy = (await page.getByTestId('copy-client-names').boundingBox())!;
    const first = (await list.locator('.client-card').first().boundingBox())!;
    expect(first.y - (copy.y + copy.height)).toBeGreaterThanOrEqual(12);
  });

  test('inputs are bordered, with a bronze focus cue', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/clients');
    const field = page.getByTestId('client-add-name');
    const idle = await field.evaluate((el) => getComputedStyle(el).borderTopColor);
    expect(idle).toBe('rgb(133, 128, 122)');
    expect(await field.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('1px');
    await field.focus();
    await expect.poll(() => field.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe('rgb(138, 106, 58)');
    expect(await field.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
  });

  test('settling is amount and note only: no Cash / Mobile money toggle, owed figure in plain ink, payment still recorded', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/clients');
    await page.getByTestId('client-filter-owes').click();
    await openPerson(page, 'Client With Debt');
    const sheet = page.getByTestId('person-sheet');
    await expect(sheet.getByRole('tab', { name: 'Cash' })).toHaveCount(0);
    await expect(sheet.getByRole('tab', { name: 'Mobile money' })).toHaveCount(0);
    await expect(sheet.getByText('Mobile money')).toHaveCount(0);
    const ink = await sheet.locator('.person-sheet__owes .v-money').evaluate((el) => getComputedStyle(el).color);
    expect(ink).toBe('rgb(33, 33, 33)');

    await sheet.getByTestId('settle-amount').fill('5000');
    await sheet.getByRole('textbox', { name: 'Note' }).fill('Cleared at counter');
    await sheet.getByTestId('settle-confirm').click();
    await page.getByRole('status').filter({ hasText: /Settled/ }).waitFor();
    const payments = driver.mock.writes.filter((w) => w.method === 'POST' && w.url.includes('/rest/v1/credit_payments'));
    expect(payments).toHaveLength(1);
    // The schema's method column still gets a fixed default.
    expect(payments[0]!.body).toMatchObject({ amount_ugx: 5000, method: 'cash', note: 'Cleared at counter' });
  });
});
