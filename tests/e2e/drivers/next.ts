import { expect, type Page } from '@playwright/test';
import type { Scenario, ScenarioStep } from '../scenarios/types';
import { installMockBackend, type MockHandle } from '../../mock';
import { PRODUCTS } from '../../../src/domain/catalog';
import { buildDefaultSeed } from '../../fixtures/seed';
import { computeTodayStats } from '../../../src/domain/today';
import { getOutstandingCredit, sumCreditOwed } from '../../../src/domain/credit';
import { groupSalesByDay } from '../../../src/domain/history-groups';

export type NextDriver = {
  mock: MockHandle;
  run: (scenario: Scenario) => Promise<void>;
};

async function saleScope(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Review sale' });
  const opened = await dialog
    .waitFor({ state: 'visible', timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  return opened ? dialog : page;
}

async function addProduct(page: Page, step: Extract<ScenarioStep, { do: 'addProduct' }>) {
  const tile = page.getByTestId(`product-${step.product}`);
  if (!(await tile.isVisible().catch(() => false))) {
    await page.goto('/next/sell');
    await tile.waitFor({ timeout: 15000 });
  }
  const review = page.getByRole('dialog', { name: 'Review sale' });
  if (await review.isVisible().catch(() => false)) {
    await review.getByRole('button', { name: 'Close' }).click();
    await review.waitFor({ state: 'hidden', timeout: 5000 });
  }
  await page.getByTestId(`product-${step.product}`).click();
  if (step.qty != null) {
    const n = Math.max(0, Math.round(step.qty));
    for (let i = 1; i < n; i += 1) {
      await page.getByTestId('config-qty-inc').click();
    }
  }
  if (step.flavors) {
    for (const [id, count] of Object.entries(step.flavors)) {
      const times = Math.max(0, Math.round(Number(count) || 0));
      for (let i = 0; i < times; i += 1) {
        await page.getByTestId(`config-flavor-${id}-inc`).click();
      }
    }
  }
  if (step.unitPrice != null) {
    await page.getByLabel(/unit price/i).fill(String(step.unitPrice));
  }
  await page.getByTestId('config-add').click();
}

function parseUgx(text: string) {
  const matches = text.replace(/,/g, '').match(/\d+/g);
  if (!matches) return 0;
  return Number(matches[matches.length - 1]);
}

let creditOwedBefore = 0;
let armInventory502 = false;

const ROUTE_TITLES: Record<string, string> = {
  '/sell': 'Sell',
  '/orders': 'Orders',
  '/stock': 'Stock',
  '/more': 'More',
  '/settings': 'Settings',
  '/clients': 'Clients',
  '/history': 'History',
  '/insights': 'Insights',
  '/cookie-partner': 'Cookie partner',
  '/delivery': 'Delivery',
  '/reviews': 'Reviews',
  '/store': 'Store',
  '/system': 'System',
};

function productLabel(id: string | undefined) {
  if (!id) return '';
  return PRODUCTS.find((p) => p.id === id)?.name || id;
}

async function saleAlreadyRecorded(page: Page) {
  return page
    .getByText(/Sale recorded|Recorded on credit/)
    .first()
    .isVisible()
    .catch(() => false);
}

async function runStep(page: Page, step: ScenarioStep, mock: MockHandle) {
  if ('do' in step) {
    switch (step.do) {
      case 'addProduct':
        await addProduct(page, step);
        return;
      case 'setClient': {
        const scope = await saleScope(page);
        await scope.getByTestId('cart-client').fill(step.name);
        return;
      }
      case 'setCredit': {
        const scope = await saleScope(page);
        await scope.getByRole('tab', { name: step.value ? 'On credit' : 'Paid' }).click();
        return;
      }
      case 'setDelivery': {
        const scope = await saleScope(page);
        await scope.getByRole('tab', { name: 'Delivery' }).click();
        if (step.destText) {
          await scope.getByTestId('place-input').fill(step.destText);
          const opt = scope.getByTestId('place-option').first();
          const shown = await opt
            .waitFor({ state: 'visible', timeout: 2500 })
            .then(() => true)
            .catch(() => false);
          if (shown) await opt.click();
        }
        if (step.feeUgx != null && step.feeEdited) {
          await scope.getByTestId('delivery-fee').fill(String(step.feeUgx));
        }
        if (step.phone) await scope.getByTestId('delivery-phone').fill(step.phone);
        if (step.deliverAt) {
          const local = step.deliverAt.length >= 16 ? step.deliverAt.slice(0, 16) : step.deliverAt;
          await scope.getByTestId('delivery-at').fill(local);
        }
        return;
      }
      case 'editLine': {
        const scope = await saleScope(page);
        await scope.getByRole('button', { name: new RegExp(`Edit ${productLabel(step.product)}`, 'i') }).click();
        const decs = page.locator('[data-testid^="config-flavor-"][data-testid$="-dec"]');
        const count = await decs.count();
        for (let i = 0; i < count; i += 1) {
          const btn = decs.nth(i);
          for (let n = 0; n < 8; n += 1) {
            if (!(await btn.isEnabled())) break;
            await btn.click();
          }
        }
        if (step.flavors) {
          for (const [id, times] of Object.entries(step.flavors)) {
            const n = Math.max(0, Math.round(Number(times) || 0));
            for (let i = 0; i < n; i += 1) await page.getByTestId(`config-flavor-${id}-inc`).click();
          }
        }
        await page.getByTestId('config-add').click();
        return;
      }
      case 'removeLine': {
        const scope = await saleScope(page);
        const label = productLabel(step.product);
        await scope.getByRole('button', { name: new RegExp(`Remove ${label}`, 'i') }).click();
        return;
      }
      case 'undo':
        await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
        return;
      case 'confirmStackedDebt': {
        const scope = await saleScope(page);
        await scope.getByTestId('charge').click();
        const debt = page.getByRole('dialog', { name: /already owes/i });
        await debt.waitFor({ state: 'visible', timeout: 8000 });
        await debt
          .getByRole('button', { name: step.accept ? /record another credit/i : /not now/i })
          .click();
        await debt.waitFor({ state: 'hidden', timeout: 8000 });
        return;
      }
      case 'charge': {
        if (await saleAlreadyRecorded(page)) return;
        const scope = await saleScope(page);
        await scope.getByTestId('charge').click();
        return;
      }
      case 'chargeRetry': {
        const scope = await saleScope(page);
        await scope.getByTestId('charge').click();
        return;
      }
      case 'doubleTapCharge': {
        const scope = await saleScope(page);
        await scope.getByTestId('charge').dblclick();
        return;
      }
      case 'loadStoreOrder': {
        await page.goto('/next/orders');
        await page.getByTestId(`load-order-${step.id}`).click();
        await page.waitForURL(/\/next\/sell/, { timeout: 10000 });
        return;
      }
      case 'confirmStoreOrder':
        await page
          .locator('[data-testid="loaded-order-confirm"], [data-testid="loaded-order-cart-confirm"]')
          .and(page.locator(':visible'))
          .first()
          .click();
        return;
      case 'cancelStoreOrder':
        await page.goto('/next/orders');
        await page.getByTestId(`cancel-order-${step.id}`).click();
        return;
      case 'dismissStoreOrder':
        await page.goto('/next/orders');
        await page.getByRole('tab', { name: 'Closed' }).click();
        await page.getByTestId(`dismiss-order-${step.id}`).click();
        return;
      case 'parkCounterCart': {
        const scope = await saleScope(page);
        await scope.getByTestId('hold-sale').click();
        await page.getByRole('status').filter({ hasText: /held/i }).waitFor({ timeout: 8000 });
        return;
      }
      case 'restoreCounterCart':
        await page.getByTestId('held-sales').getByRole('button').first().click();
        return;
      case 'arriveStoreOrder': {
        await page.getByTestId('orders-badge').waitFor({ timeout: 8000 });
        const socketDeadline = Date.now() + 8000;
        while (mock.realtimeClients < 1 && Date.now() < socketDeadline) {
          await page.waitForTimeout(50);
        }
        if (mock.realtimeClients < 1) throw new Error('realtime socket did not open');
        mock.db.table('store_orders').unshift({
          id: 'arrived-live-order',
          status: 'pending',
          customer_name: 'Live Customer',
          phone_e164: '+256700000050',
          created_at: new Date().toISOString(),
          confirmed_at: null,
          dismissed_at: null,
          sale_id: null,
          items: [
            {
              product_id: 'scout',
              product_name: 'Scout Pack',
              detail: 'Mint',
              line_total: 8000,
              breakdown: { mint: 1 },
            },
          ],
          delivery_enabled: false,
        });
        mock.notifyRealtime();
        return;
      }
      case 'setStoreBusy':
        await page.goto('/next/store');
        await page.getByTestId(step.minutes == null ? 'busy-clear' : 'busy-30').click();
        return;
      case 'setStoreHours': {
        await page.goto('/next/store');
        await page.getByRole('textbox', { name: 'Open' }).fill(step.open);
        await page.getByRole('textbox', { name: 'Close' }).fill(step.close);
        const suggest = String(step.suggest || '');
        const parts = suggest.split(/[–-]/);
        if (parts[0]) await page.getByRole('textbox', { name: 'Suggest start' }).fill(parts[0].trim());
        if (parts[1]) await page.getByRole('textbox', { name: 'Suggest end' }).fill(parts[1].trim());
        await page.getByRole('button', { name: /save hours/i }).click();
        return;
      }
      case 'clientsCrud': {
        await page.goto('/next/clients');
        if (step.action === 'add') {
          await page.getByTestId('client-add-name').fill(step.name || '');
          await page.getByTestId('client-add').click();
          await page.getByText('Client added').first().waitFor();
          return;
        }
        await page.getByRole('button', { name: new RegExp(step.name || '', 'i') }).first().click();
        if (step.action === 'rename') {
          await page.getByTestId('client-edit-name').fill(step.newName || '');
          await page.getByTestId('client-rename').click();
          await page.getByText('Client renamed').first().waitFor();
          return;
        }
        await page.getByTestId('client-delete').click();
        await page.getByTestId('client-delete-confirm').click();
        return;
      }
      case 'storeUsers':
        await page.goto('/next/clients');
        await page.getByTestId('client-filter-storefront').click();
        await page.getByTestId('person-acc-2').getByRole('button').click();
        if (step.action === 'setName') {
          await page.getByTestId('store-user-name').fill(step.name || '');
          await page.getByTestId('store-user-save').click();
          return;
        }
        if (step.action === 'verify') {
          await page.getByTestId('store-user-verify').click();
          return;
        }
        await page.getByTestId('store-user-delete').click();
        await page.getByTestId('store-user-delete-confirm').click();
        return;
      case 'quoteLabPreset':
        await page.goto('/next/delivery');
        await page.getByTestId('quote-log').click();
        return;
      case 'refreshReviews':
        await page.goto('/next/reviews');
        await page.getByTestId('reviews-refresh').click();
        return;
      case 'enableNotifications':
        await page.goto('/next/settings');
        await page.getByTestId('enable-notifications').click();
        return;
      case 'partnerSettleBatch':
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.goto('/next/cookie-partner');
        await page.getByTestId('partner-settle').click();
        await page.getByTestId('partner-confirm-send').click();
        await page.getByRole('status').filter({ hasText: /settled|cookies/i }).waitFor({ timeout: 8000 });
        return;
      case 'goOffline':
        mock.setOffline(true);
        return;
      case 'settleCredit': {
        await page.goto('/next/clients');
        const name = step.clientName || '';
        const row = page.getByRole('button', { name: new RegExp(name, 'i') }).first();
        await row.waitFor({ timeout: 8000 });
        creditOwedBefore = parseUgx(await row.innerText());
        await row.click();
        await page.getByTestId('settle-amount').fill(String(step.amountUgx));
        if (step.note) await page.getByRole('textbox', { name: 'Note' }).fill(step.note);
        await page.getByTestId('settle-confirm').click();
        return;
      }
      case 'adjustStock':
        await page.goto(`/next/stock`);
        await page.getByTestId(`stock-${step.categoryId}-qty`).waitFor();
        if (armInventory502) {
          mock.setFailure({
            method: 'POST',
            pathIncludes: '/api/inventory/write',
            bodyOp: 'delta',
            status: 502,
            times: 1,
          });
          armInventory502 = false;
        }
        if (step.delta === 24) {
          await page.getByTestId(`stock-${step.categoryId}-qty`).click();
          await page.getByTestId('stock-bulk-24').click();
          await page.getByTestId('stock-set-confirm').click();
          await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 8000 });
          return;
        }
        const qty = page.getByTestId(`stock-${step.categoryId}-qty`);
        const before = Number((await qty.innerText()).trim());
        // Resolve on the delta/set write, or on the 502 fallback PATCH.
        // A 502 itself must not resolve the waiter: the PATCH can finish
        // before a second waitForResponse is registered.
        const settled = page.waitForResponse((res) => {
          const method = res.request().method();
          const url = res.url();
          if (method === 'PATCH' && url.includes('/rest/v1/inventory')) return true;
          if (method === 'POST' && url.includes('/api/inventory/write') && res.status() < 500) {
            const body = res.request().postData() || '';
            return body.includes('"delta"') || body.includes('"set"');
          }
          return false;
        });
        if (step.delta > 0) {
          for (let i = 0; i < step.delta; i += 1) {
            await page.getByTestId(`stock-${step.categoryId}-inc`).click();
          }
        } else {
          for (let i = 0; i < Math.abs(step.delta); i += 1) {
            await page.getByTestId(`stock-${step.categoryId}-dec`).click();
          }
        }
        await settled;
        await expect(qty).toHaveText(String(Math.max(0, before + step.delta)));
        return;
      case 'setStockCount':
        await page.goto(`/next/stock`);
        await page.getByTestId(`stock-${step.categoryId}-qty`).click();
        const countInput = page.getByTestId('stock-set-count');
        await countInput.waitFor({ state: 'visible' });
        await countInput.fill(String(step.qty));
        await page.getByTestId('stock-set-confirm').click();
        await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 8000 });
        return;
      case 'editSale':
        await page.goto('/next/history');
        await page.getByTestId(`history-sale-${step.saleId}`).click();
        await page.getByTestId('sale-edit').click();
        await page.getByTestId('sale-edit-inc').click();
        await page.getByTestId('sale-edit-save').click();
        return;
      case 'voidSale':
        await page.goto('/next/history');
        await page.getByTestId(`history-sale-${step.saleId}`).click();
        await page.getByTestId('sale-void').click();
        await page.getByTestId('void-confirm').click();
        return;
      case 'editDeliveryTrip':
        await page.goto('/next/delivery');
        await page.getByTestId(`trip-${step.id}`).click();
        await page.getByTestId('trip-fee').fill('9000');
        await page.getByTestId('trip-save').click();
        return;
      case 'signOut':
        await page.goto('/next/settings');
        await page.getByTestId('sign-out').click();
        await page.waitForURL(/auth\.html/, { timeout: 8000 });
        {
          const raw = await page.evaluate(() => localStorage.getItem('venus-pos-auth'));
          if (raw) throw new Error('session still stored after sign out');
        }
        return;
      case 'signIn': {
        const next = step.next || '/next/sell';
        const url = new URL(page.url());
        if (url.searchParams.get('next') !== next) {
          url.searchParams.set('next', next);
          await page.goto(`${url.pathname}${url.search}`);
        }
        await page.getByLabel('Email').fill('staff@test.local');
        await page.getByLabel('Password').fill('test-password');
        await page.getByRole('button', { name: 'Sign in' }).click();
        return;
      }
      case 'go':
        await page.goto(`/next${step.path.startsWith('/') ? step.path : `/${step.path}`}`);
        return;
      default:
        // Intent reserved for later drivers — no-op for now.
        return;
    }
  }

  if ('expect' in step) {
    switch (step.expect) {
      case 'saleRecorded': {
        await page.getByText(/Sale recorded|Recorded on credit/).first().waitFor({ timeout: 10000 });
        const formatted = String(step.total).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        await page.getByText(new RegExp(formatted)).first().waitFor({ timeout: 5000 });
        return;
      }
      case 'stock':
        await page.goto('/next/stock');
        await page.getByTestId(`stock-${step.categoryId}-qty`).filter({ hasText: String(step.qty) }).waitFor();
        return;
      case 'toast':
        await page.getByRole('status').filter({ hasText: new RegExp(step.message, 'i') }).waitFor({
          timeout: 8000,
        });
        return;
      case 'noWrites': {
        const bad = mock.writes.filter((w) => {
          if (w.method === 'POST' && w.url.includes('/rest/v1/sales')) return true;
          return (w.body as { op?: string } | null)?.op === 'delta';
        });
        if (bad.length) throw new Error(`expected no sale or stock writes, saw ${bad.length}`);
        return;
      }
      case 'noProduct':
        await page.getByTestId('product-scout').waitFor({ timeout: 15000 });
        if ((await page.getByTestId(`product-${step.product}`).count()) > 0) {
          throw new Error(`${step.product} is still on the Sell screen`);
        }
        return;
      case 'display': {
        if (step.values.todayRevenue === 'legacy') {
          const seed = buildDefaultSeed();
          const expectedToday = computeTodayStats(seed.sales as Parameters<typeof computeTodayStats>[0]);
          const expectedOwed = sumCreditOwed(getOutstandingCredit(seed.sales as Parameters<typeof getOutstandingCredit>[0]));
          const expectedGroups = groupSalesByDay(seed.sales).length;
          await page.goto('/next/sell');
          const pill = page.getByTestId('today-pill');
          await pill.waitFor({ timeout: 15000 });
          const deadline = Date.now() + 8000;
          let revenue = Number(await pill.getAttribute('data-revenue'));
          let joints = Number(await pill.getAttribute('data-joints'));
          while (
            (revenue !== expectedToday.revenue || joints !== expectedToday.joints) &&
            Date.now() < deadline
          ) {
            await page.waitForTimeout(200);
            revenue = Number(await pill.getAttribute('data-revenue'));
            joints = Number(await pill.getAttribute('data-joints'));
          }
          if (revenue !== expectedToday.revenue || joints !== expectedToday.joints) {
            throw new Error(
              `today pill revenue ${revenue} joints ${joints}, expected ${expectedToday.revenue} / ${expectedToday.joints}`,
            );
          }
          await page.goto('/next/insights');
          const insight = page.getByTestId('insights-today');
          await insight.waitFor({ timeout: 8000 });
          const insightDeadline = Date.now() + 8000;
          let insightRevenue = Number(await insight.getAttribute('data-revenue'));
          while (insightRevenue !== expectedToday.revenue && Date.now() < insightDeadline) {
            await page.waitForTimeout(200);
            insightRevenue = Number(await insight.getAttribute('data-revenue'));
          }
          if (insightRevenue !== expectedToday.revenue) {
            throw new Error(`insights today ${insightRevenue}, expected ${expectedToday.revenue}`);
          }
          const creditEl = page.getByTestId('insights-credit');
          let shown = Number(await creditEl.getAttribute('data-owed'));
          const creditDeadline = Date.now() + 8000;
          while (shown !== expectedOwed && Date.now() < creditDeadline) {
            await page.waitForTimeout(200);
            shown = Number(await creditEl.getAttribute('data-owed'));
          }
          if (shown !== expectedOwed) throw new Error(`credit ${shown}, expected ${expectedOwed}`);
          await page.goto('/next/history');
          await page.getByTestId('history-day').first().waitFor({ timeout: 8000 });
          const groups = await page.getByTestId('history-day').count();
          if (groups !== expectedGroups) throw new Error(`history groups ${groups}, expected ${expectedGroups}`);
          await page.goto('/next/clients');
          const row = page.getByRole('button', { name: /client with debt/i }).first();
          await row.waitFor({ timeout: 8000 });
          const debtDeadline = Date.now() + 8000;
          let debt = parseUgx(await row.innerText());
          while (debt !== 15000 && Date.now() < debtDeadline) {
            await page.waitForTimeout(200);
            debt = parseUgx(await row.innerText());
          }
          if (debt !== 15000) throw new Error(`client debt row ${debt}, expected 15000`);
        }
        if (step.values.cartLines != null) {
          const n = Number(step.values.cartLines);
          const lines = page.locator('[data-desktop-cart]').getByRole('button', { name: /^Remove / });
          const deadline = Date.now() + 8000;
          let count = await lines.count();
          while (count !== n && Date.now() < deadline) {
            await page.waitForTimeout(200);
            count = await lines.count();
          }
          if (count !== n) throw new Error(`expected ${n} cart lines, saw ${count}`);
        }
        if (step.values.creditOwedDelta != null) {
          const expected = Number(step.values.creditOwedDelta);
          const row = page.getByRole('button', { name: /client with debt/i }).first();
          const deadline = Date.now() + 8000;
          let delta = parseUgx(await row.innerText()) - creditOwedBefore;
          while (delta !== expected && Date.now() < deadline) {
            await page.waitForTimeout(200);
            delta = parseUgx(await row.innerText()) - creditOwedBefore;
          }
          if (delta !== expected) {
            throw new Error(`owed delta ${delta}, expected ${expected} (before ${creditOwedBefore})`);
          }
        }
        if (typeof step.values.creditOwed === 'number' || (typeof step.values.creditOwed === 'string' && step.values.creditOwed !== 'legacy' && step.values.creditOwed !== '')) {
          const expected = Number(step.values.creditOwed);
          const row = page.getByRole('button', { name: /client with debt/i }).first();
          const deadline = Date.now() + 8000;
          let owed = /clear/i.test(await row.innerText()) ? 0 : parseUgx(await row.innerText());
          while (owed !== expected && Date.now() < deadline) {
            await page.waitForTimeout(200);
            const text = await row.innerText();
            owed = /clear/i.test(text) ? 0 : parseUgx(text);
          }
          if (owed !== expected) throw new Error(`owed ${owed}, expected ${expected}`);
        }
        if (step.values.busy === 'off') {
          const status = page.getByTestId('store-status');
          const deadline = Date.now() + 8000;
          let text = await status.innerText();
          while (/Status:\s*Busy/i.test(text) && Date.now() < deadline) {
            await page.waitForTimeout(200);
            text = await status.innerText();
          }
          if (/Status:\s*Busy/i.test(text)) throw new Error(`expected busy off, saw ${text}`);
        }
        if (step.values.reviews != null) {
          const raw = String(step.values.reviews);
          const count = Number((await page.getByTestId('review-count').innerText()).match(/\d+/)?.[0] || 0);
          if (raw.startsWith('>=') && count < Number(raw.slice(2))) {
            throw new Error(`expected reviews ${raw}, saw ${count}`);
          }
        }
        return;
      }
      case 'clipboard': {
        const text = await page.evaluate(() => navigator.clipboard.readText());
        if (!text.toLowerCase().includes(String(step.includes).toLowerCase())) {
          throw new Error(`clipboard missing ${step.includes}: ${text}`);
        }
        return;
      }
      case 'reachable': {
        for (const route of step.routes) {
          await page.goto(`/next${route}`);
          const title = ROUTE_TITLES[route] || route;
          await page.locator('.shell__sync-label', { hasText: title }).waitFor({ timeout: 8000 });
        }
        return;
      }
      case 'redirect': {
        const path = step.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await page.waitForURL(new RegExp(`${path}\\/?$`), { timeout: 8000 });
        return;
      }
      default:
        return;
    }
  }
}

export async function createNextDriver(page: Page, opts: { role?: 'pos_admin' | 'pos_staff'; seed?: 'default' | 'empty' } = {}): Promise<NextDriver> {
  const mock = await installMockBackend(page, {
    role: opts.role || 'pos_staff',
    seed: opts.seed || 'default',
  });

  return {
    mock,
    async run(scenario) {
      if (scenario.steps.some((step) => 'do' in step && step.do === 'chargeRetry')) {
        mock.setFailure({ method: 'POST', table: 'sales', status: 500, times: 1 });
      }
      if (scenario.id === 'S46' || scenario.id === 'S49') {
        await page.addInitScript(() => sessionStorage.setItem('venus-enforce-access', '1'));
      }
      armInventory502 = scenario.id === 'S32';
      const first = scenario.steps[0];
      creditOwedBefore = 0;
      if (!first || !('do' in first) || first.do !== 'go') {
        await page.goto('/next/sell');
        await page.getByRole('heading', { name: /packs|sell|today/i }).first().waitFor({ timeout: 15000 }).catch(() => {});
      }
      for (const step of scenario.steps) {
        await runStep(page, step, mock);
      }
    },
  };
}
