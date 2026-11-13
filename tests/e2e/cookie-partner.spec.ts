import { expect, test, type Page } from '@playwright/test';
import { installMockBackend } from '../mock';
import { buildDefaultSeed } from '../fixtures/seed';
import { expandPartnerUnitsFromSales } from '../../src/domain/partner';
import { settledCutsFor } from '../../src/domain/partner-send';

// The seed's cookie units, so a test can say "k cookies are open" without hard-coding the seed.
const TOTAL = expandPartnerUnitsFromSales(buildDefaultSeed().sales as Parameters<typeof expandPartnerUnitsFromSales>[0]).length;

async function open(page: Page, openCount: number, extra: Parameters<typeof installMockBackend>[1] = {}) {
  const qty = TOTAL - openCount;
  const mock = await installMockBackend(page, {
    role: 'pos_admin',
    partnerSettle: { qty, batches: settledCutsFor(qty, null) },
    ...extra,
  });
  await page.goto('/next/cookie-partner');
  await expect(page.getByTestId('partner-settled-qty')).toHaveText(new RegExp(`${qty} cookies already settled`));
  return { mock, qty };
}

const posts = (mock: Awaited<ReturnType<typeof installMockBackend>>) =>
  mock.writes.filter((w) => w.method === 'POST' && w.url.includes('/api/cookie-partner/settle'));

test.describe('Cookie partner page', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('the seed has enough cookies to work with', () => {
    expect(TOTAL).toBeGreaterThan(30);
  });

  test('a part-filled batch can be sent: confirm first, then one write with the partial cut', async ({ page }) => {
    const { mock, qty } = await open(page, 6);
    await expect(page.getByTestId('partner-open-count')).toHaveText('6');
    await expect(page.getByTestId('partner-progress')).toHaveAttribute('aria-valuenow', '6');
    await expect(page.getByText('Part batch').first()).toBeVisible();
    const button = page.getByTestId('partner-settle');
    await expect(button).toHaveText('Send part batch · 6 cookies');
    await expect(page.getByTestId('partner-note')).toContainText('next batch then starts from 0');

    await button.click();
    await expect(page.getByTestId('partner-confirm')).toContainText('6 cookies');
    await expect(page.getByTestId('partner-confirm')).toContainText('part batch (6 of 25)');
    // Asking to confirm writes nothing.
    expect(posts(mock)).toHaveLength(0);

    await page.getByTestId('partner-confirm-cancel').click();
    expect(posts(mock)).toHaveLength(0);

    await button.click();
    await page.getByTestId('partner-confirm-send').click();
    await expect(page.getByTestId('partner-settled-qty')).toHaveText(`${qty + 6} cookies already settled`);
    expect(posts(mock)).toHaveLength(1);
    const body = posts(mock)[0]!.body as { settled_qty: number; batches: number[]; qty_before: number };
    expect(body.settled_qty).toBe(qty + 6);
    expect(body.qty_before).toBe(qty);
    expect(body.batches.at(-1)).toBe(6);
    expect(body.batches.reduce((a, b) => a + b, 0)).toBe(qty + 6);
    // The part batch is in the history, and nothing is left to send.
    await expect(page.getByTestId('partner-history').getByText('Part batch').first()).toBeVisible();
    await expect(page.getByTestId('partner-settle')).toHaveCount(0);
    await expect(page.getByTestId('partner-open-count')).toHaveText('0');
  });

  test('a full batch is offered as a full batch, and a partial is not offered beside it', async ({ page }) => {
    const { mock, qty } = await open(page, 27);
    await expect(page.getByTestId('partner-settle')).toHaveText(/^Send batch \d+ · 25 cookies$/);
    await expect(page.getByText('Full batch ready')).toBeVisible();
    await page.getByTestId('partner-settle').click();
    await expect(page.getByTestId('partner-confirm')).not.toContainText('part batch');
    await page.getByTestId('partner-confirm-send').click();
    await expect(page.getByTestId('partner-settled-qty')).toHaveText(`${qty + 25} cookies already settled`);
    expect((posts(mock)[0]!.body as { settled_qty: number }).settled_qty).toBe(qty + 25);
    // The 2 left over are now a part batch.
    await expect(page.getByTestId('partner-settle')).toHaveText('Send part batch · 2 cookies');
  });

  test('nothing open means no send button', async ({ page }) => {
    await open(page, 0);
    await expect(page.getByTestId('partner-settle')).toHaveCount(0);
    await expect(page.getByTestId('partner-note')).toContainText('No cookies waiting');
  });

  test('another device is already ahead: the card refreshes and nothing is written', async ({ page }) => {
    const qty = TOTAL - 6;
    const mock = await installMockBackend(page, {
      role: 'pos_admin',
      partnerSettle: { qty, batches: settledCutsFor(qty, null) },
    });
    // Page load sees the old total. The pre-send check sees that another device moved ahead.
    let gets = 0;
    await page.route('**/api/cookie-partner/settle', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      gets += 1;
      if (gets === 1) return route.fallback();
      const ahead = qty + 6;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, settled_qty: ahead, batches: settledCutsFor(ahead, null) }),
      });
    });
    await page.goto('/next/cookie-partner');
    await page.getByTestId('partner-settle').click();
    await page.getByTestId('partner-confirm-send').click();
    await expect(page.getByRole('status').filter({ hasText: 'Another device already updated this' })).toBeVisible();
    await expect(page.getByTestId('partner-settled-qty')).toHaveText(`${qty + 6} cookies already settled`);
    expect(posts(mock)).toHaveLength(0);
  });

  test('a server error marks nothing sent and leaves the button', async ({ page }) => {
    const mock = await installMockBackend(page, {
      role: 'pos_admin',
      partnerSettle: { qty: TOTAL - 6, batches: settledCutsFor(TOTAL - 6, null) },
    });
    await page.route('**/api/cookie-partner/settle', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/next/cookie-partner');
    await page.getByTestId('partner-settle').click();
    await page.getByTestId('partner-confirm-send').click();
    await expect(page.getByRole('status').filter({ hasText: 'Server error (500). Batch NOT marked sent' })).toBeVisible();
    await expect(page.getByTestId('partner-settled-qty')).toHaveText(`${TOTAL - 6} cookies already settled`);
    await expect(page.getByTestId('partner-settle')).toBeVisible();
    expect(posts(mock)).toHaveLength(0);
  });

  test('never writes when the server is unreachable', async ({ page }) => {
    const mock = await installMockBackend(page, {
      role: 'pos_admin',
      partnerSettle: { qty: TOTAL - 6, batches: settledCutsFor(TOTAL - 6, null) },
    });
    let gets = 0;
    await page.route('**/api/cookie-partner/settle', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      gets += 1;
      return gets === 1 ? route.fallback() : route.abort('failed');
    });
    await page.goto('/next/cookie-partner');
    await page.getByTestId('partner-settle').click();
    await page.getByTestId('partner-confirm-send').click();
    await expect(page.getByRole('status').filter({ hasText: 'Could not reach the server' })).toBeVisible();
    expect(posts(mock)).toHaveLength(0);
  });

  test('the live shape: 262 settled with a part batch of 12 shows every batch, newest first', async ({ page }) => {
    const cuts = [...Array.from({ length: 10 }, () => 25), 12];
    await installMockBackend(page, { role: 'pos_admin', partnerSettle: { qty: 262, batches: cuts } });
    await page.goto('/next/cookie-partner');
    await expect(page.getByTestId('partner-settled-qty')).toHaveText('262 cookies already settled');
    await expect(page.getByTestId('partner-settle')).toHaveCount(0);
    const history = page.getByTestId('partner-history');
    await expect(history.getByTestId('partner-batch-11')).toContainText('Batch 11 · 12/25');
    await expect(history.getByTestId('partner-batch-11')).toContainText('Part batch');
    await expect(history.getByTestId('partner-batch-1')).toHaveCount(0);
    await page.getByTestId('partner-history-more').click();
    await expect(history.getByTestId('partner-batch-1')).toContainText('Batch 1 · 25/25');
  });

  test('Insights keeps a small summary that opens the page, and More lists it', async ({ page }) => {
    await open(page, 6);
    await page.goto('/next/insights');
    const tile = page.getByTestId('partner-summary');
    await expect(tile).toContainText('Cookie partner');
    await expect(tile).toContainText('6 of 25');
    await expect(page.getByTestId('partner-settle')).toHaveCount(0);
    await tile.click();
    await expect(page.getByTestId('cookie-partner-page')).toBeVisible();
    await page.goto('/next/more');
    await page.getByRole('button', { name: 'Cookie partner' }).click();
    await expect(page.getByTestId('cookie-partner-page')).toBeVisible();
  });
});
