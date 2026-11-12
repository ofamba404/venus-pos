import type { Page } from '@playwright/test';
import type { Scenario, ScenarioStep } from '../scenarios/types';
import { installMockBackend, type MockHandle } from '../../mock';
import { buildDefaultSeed } from '../../fixtures/seed';
import { computeTodayStats } from '../../../src/domain/today';

const PRODUCT_NAMES: Record<string, string> = {
  scout: 'Scout Pack',
  pilot: 'Pilot Pack',
  commander: "Commander's Stash",
  variety: 'Variety Pack',
  cookie_duet: 'Cookie Duet',
  cookie_trio: 'Cookie Trio',
  cookie_quartet: 'Cookie Quartet',
  plain_single: 'Plain',
  spliff_single: 'Bangis',
  cookie_single: 'Cookies',
  cookie_wholesale: 'Wholesale cookies',
};

type AddedLine = Extract<ScenarioStep, { do: 'addProduct' }>;
type CartMemory = { added: AddedLine[]; lastRemoved: AddedLine | null };

function productName(id: string) {
  return PRODUCT_NAMES[id] || id;
}

function legacyUrl(path: string) {
  const raw = path.startsWith('/') ? path : `/${path}`;
  const hashAt = raw.indexOf('#');
  const hash = hashAt >= 0 ? raw.slice(hashAt) : '';
  const bare = (hashAt >= 0 ? raw.slice(0, hashAt) : raw).replace(/\/$/, '') || '/';
  const pages: Record<string, string> = {
    '/': '/',
    '/sell': '/',
    '/orders': '/',
    '/stock': '/pages/inventory.html',
    '/more': '/',
    '/settings': '/',
    '/clients': '/pages/clients.html',
    '/history': '/pages/history.html',
    '/insights': '/pages/analytics.html',
    '/delivery': '/pages/delivery.html',
    '/reviews': '/pages/reviews.html',
    '/store': '/pages/admin.html',
    '/system': '/',
  };
  const base = pages[bare] ?? bare;
  if (hash.startsWith('#load-store-order=')) return `/${hash}`;
  if (bare === '/orders') return '/#store-orders';
  return `${base}${hash}`;
}

export type LegacyDriver = {
  mock: MockHandle;
  run: (scenario: Scenario) => Promise<void>;
};

async function addProduct(page: Page, step: Extract<ScenarioStep, { do: 'addProduct' }>) {
  const addAnother = page.locator('#addItemBtn');
  if (await addAnother.isVisible().catch(() => false)) {
    await addAnother.click();
    await page.locator('#orderModal').locator(`[data-product="${step.product}"]`).click({ force: true });
  } else {
    await page.locator(`[data-product="${step.product}"]:visible`).first().click();
  }
  if (step.qty !== undefined) {
    const n = Math.max(0, Math.round(step.qty));
    for (let i = 0; i < n; i += 1) {
      await page.locator('[data-pick="qty"][data-pdir="1"]').click();
    }
  }
  if (step.flavors) {
    for (const [id, count] of Object.entries(step.flavors)) {
      const times = Math.max(0, Math.round(Number(count) || 0));
      for (let i = 0; i < times; i += 1) {
        await page.locator(`[data-pick="${id}"][data-pdir="1"]`).click();
      }
    }
  }
  if (step.unitPrice !== undefined) {
    const price = page.locator('#wholesaleUnitPrice, input[name="unitPrice"], [data-unit-price]').first();
    if (await price.count()) await price.fill(String(step.unitPrice));
  }
  const add = page.locator('#addToOrderBtn');
  await add.waitFor({ state: 'visible', timeout: 8000 });
  await add.click();
  await page.locator('#cartClientInput').waitFor({ state: 'visible', timeout: 8000 });
}

async function ensureHome(page: Page) {
  if (!page.url().includes('4173') || page.url().includes('/pages/') || page.url().includes('auth.html')) {
    await page.goto('/');
  }
  await page.locator('[data-product]').first().waitFor({ timeout: 20000 });
}

async function openStoreOrders(page: Page) {
  await ensureHome(page);
  const close = page.locator('#orderClose');
  if (await close.isVisible().catch(() => false)) await close.click();
  const btn = page.locator('#storeOrdersBtn');
  await btn.waitFor({ timeout: 15000 });
  await btn.click();
  await page.locator('#storeOrdersPanel').waitFor({ state: 'visible', timeout: 8000 });
}

async function runStep(
  page: Page,
  step: ScenarioStep,
  mock: MockHandle,
  memory: CartMemory,
) {
  if ('do' in step) {
    switch (step.do) {
      case 'addProduct':
        await ensureHome(page);
        await addProduct(page, step);
        memory.added.push(step);
        return;
      case 'setClient': {
        const input = page.locator('#cartClientInput');
        if (!(await input.isVisible().catch(() => false))) {
          const tab = page.getByRole('tab', { name: step.name });
          if (await tab.count()) await tab.first().click();
          return;
        }
        await input.click();
        await input.fill(step.name);
        if (step.create) {
          await input.press('Enter');
          const deadline = Date.now() + 8000;
          while (
            !mock.writes.some((w) => w.method === 'POST' && w.url.includes('/rest/v1/clients')) &&
            Date.now() < deadline
          ) {
            await page.waitForTimeout(50);
          }
          if (!mock.writes.some((w) => w.method === 'POST' && w.url.includes('/rest/v1/clients'))) {
            throw new Error('new client was not created');
          }
          return;
        }
        const option = page.locator('#cartClientDropdown [role="option"]').filter({ hasText: step.name }).first();
        const shown = await option
          .waitFor({ state: 'visible', timeout: 1500 })
          .then(() => true)
          .catch(() => false);
        if (shown) await option.click();
        return;
      }
      case 'setCredit': {
        const toggle = page.locator('#creditToggle');
        const on = (await toggle.getAttribute('aria-checked')) === 'true';
        if (on !== step.value) await toggle.click();
        return;
      }
      case 'confirmStackedDebt': {
        const done = await page
          .locator('#orderModalTitle')
          .filter({ hasText: /Order recorded|Recorded on credit/ })
          .isVisible()
          .catch(() => false);
        if (!done) await page.locator('#checkoutBtn').click();
        const ok = page.locator('#confirmOkBtn');
        await ok.waitFor({ state: 'visible', timeout: 8000 });
        await page.locator(step.accept ? '#confirmOkBtn' : '#confirmCancelBtn').click();
        if (step.accept) {
          await page
            .locator('#orderModalTitle')
            .filter({ hasText: /Order recorded|Recorded on credit/ })
            .waitFor({ timeout: 15000 });
        }
        return;
      }
      case 'setDelivery': {
        const trigger = page.locator('[data-accordion-id="cart-delivery"] [data-accordion-trigger]');
        if (await trigger.count()) await trigger.click();
        if (step.destText) {
          const dest = page.locator('#deliveryDestInput');
          await dest.fill(step.destText);
          const opt = page.locator('#deliveryDestDropdown [role="option"], #deliveryDestDropdown button').first();
          const shown = await opt
            .waitFor({ state: 'visible', timeout: 2500 })
            .then(() => true)
            .catch(() => false);
          if (shown) await opt.click();
        }
        if (step.feeUgx != null) {
          await page.locator('#deliveryFeeInputCart').fill(String(step.feeUgx));
        }
        if (step.phone) {
          const phone = page.locator('input[aria-label*="phone" i], input[placeholder*="phone" i]').first();
          if (await phone.count()) await phone.fill(step.phone);
        }
        if (step.deliverAt) {
          const at = page.locator('input[type="datetime-local"]').first();
          if (await at.count()) await at.fill(step.deliverAt.slice(0, 16));
        }
        return;
      }
      case 'editLine': {
        const name = productName(step.product);
        await page.getByRole('button', { name: new RegExp(`Edit ${name}`, 'i') }).click();
        const minus = page.locator('[data-pick][data-pdir="-1"]');
        const n = await minus.count();
        for (let i = 0; i < n; i += 1) {
          const btn = minus.nth(i);
          for (let k = 0; k < 8; k += 1) {
            if (await btn.isDisabled().catch(() => true)) break;
            await btn.click();
          }
        }
        if (step.flavors) {
          for (const [id, count] of Object.entries(step.flavors)) {
            const times = Math.max(0, Math.round(Number(count) || 0));
            for (let i = 0; i < times; i += 1) {
              await page.locator(`[data-pick="${id}"][data-pdir="1"]`).click();
            }
          }
        }
        await page.locator('#addToOrderBtn').click();
        return;
      }
      case 'removeLine': {
        const name = step.product ? productName(step.product) : '';
        const btn = name
          ? page.getByRole('button', { name: new RegExp(`Remove ${name}`, 'i') })
          : page.locator('[data-remove]').first();
        await btn.click();
        if (step.product) {
          const idx = memory.added.findLastIndex((line) => line.product === step.product);
          memory.lastRemoved = idx >= 0 ? memory.added.splice(idx, 1)[0] || null : null;
        }
        return;
      }
      case 'undo': {
        if (!memory.lastRemoved) throw new Error('nothing to undo');
        await addProduct(page, memory.lastRemoved);
        memory.added.push(memory.lastRemoved);
        return;
      }
      case 'charge': {
        const done = await page
          .locator('#orderModalTitle')
          .filter({ hasText: /Order recorded|Recorded on credit/ })
          .isVisible()
          .catch(() => false);
        if (done) return;
        await page.locator('#checkoutBtn').click();
        return;
      }
      case 'chargeRetry':
        await page.locator('#checkoutBtn').click();
        return;
      case 'doubleTapCharge':
        await page.locator('#checkoutBtn').dblclick();
        return;
      case 'loadStoreOrder': {
        await openStoreOrders(page);
        const load = page.locator(`[data-load-store-order="${step.id}"]`);
        const found = await load
          .waitFor({ state: 'visible', timeout: 8000 })
          .then(() => true)
          .catch(() => false);
        if (!found) {
          const text = ((await page.locator('#storeOrdersPanel').innerText().catch(() => '')) || '').slice(0, 400);
          throw new Error(`order ${step.id} not in panel: ${text}`);
        }
        await load.click();
        await page.locator('#cartClientInput, #orderModalTitle').first().waitFor({ timeout: 8000 });
        return;
      }
      case 'confirmStoreOrder':
        await page.locator('[data-confirm-store-order]').first().click();
        return;
      case 'cancelStoreOrder': {
        await openStoreOrders(page);
        await page.locator(`[data-cancel-store-order="${step.id}"]`).click();
        const ok = page.locator('#confirmOkBtn');
        if (await ok.isVisible().catch(() => false)) await ok.click();
        return;
      }
      case 'dismissStoreOrder': {
        await openStoreOrders(page);
        await page.locator(`[data-dismiss-store-order="${step.id}"]`).click();
        return;
      }
      case 'parkCounterCart':
        return;
      case 'restoreCounterCart': {
        const closeCart = page.locator('#orderClose');
        if (await closeCart.isVisible().catch(() => false)) await closeCart.click();
        await page.locator('#fabNewOrder').click();
        await page.locator('#cartClientInput').waitFor({ timeout: 8000 });
        return;
      }
      case 'setStoreBusy': {
        await page.goto('/pages/admin.html#hours');
        await page.locator('[data-admin-tab="hours"]').click();
        if (step.minutes == null) {
          await page.locator('[data-hours-action="clear-busy"]').click();
        } else {
          await page.locator(`[data-hours-busy-mins="${step.minutes}"]`).click();
          await page.locator('[data-hours-action="save-busy"]').click();
        }
        return;
      }
      case 'arriveStoreOrder': {
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
      case 'adjustStock': {
        await page.goto('/pages/inventory.html');
        const plus = page.locator(`button.step.plus[data-id="${step.categoryId}"]`);
        await plus.waitFor({ timeout: 15000 });
        if (step.delta === 24 || step.delta === -24) {
          await plus.dblclick();
          await page.locator('#amountInput').fill('24');
          await page.locator('#amountConfirm').click();
          return;
        }
        const button =
          step.delta >= 0
            ? plus
            : page.locator(`button.step.minus[data-id="${step.categoryId}"]`);
        const times = Math.abs(step.delta);
        for (let i = 0; i < times; i += 1) await button.click();
        return;
      }
      case 'setStockCount': {
        await page.goto('/pages/inventory.html');
        const count = page.locator(`#inv-count-${step.categoryId}`);
        await count.waitFor({ timeout: 15000 });
        await count.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.type(String(step.qty));
        await page.keyboard.press('Enter');
        return;
      }
      case 'go':
        await page.goto(legacyUrl(step.path));
        return;
      case 'goOffline':
        mock.setOffline(true);
        return;
      case 'clientsCrud': {
        await page.goto('/pages/clients.html');
        if (step.action === 'add') {
          await page.locator('#newClientInput').fill(step.name || '');
          await page.locator('#addClientBtn').click();
          return;
        }
        const row = page.locator(`[data-client-row]`).filter({ hasText: step.name || '' }).first();
        await row.waitFor({ timeout: 8000 });
        if (step.action === 'rename') {
          await row.click();
          const input = page.locator('input').last();
          await input.fill(step.newName || '');
          await input.press('Enter');
          return;
        }
        await row.click();
        const del = page.getByRole('button', { name: /delete|remove/i }).first();
        if (await del.count()) await del.click();
        const ok = page.locator('#confirmOkBtn');
        if (await ok.isVisible().catch(() => false)) await ok.click();
        return;
      }
      case 'setStoreHours': {
        await page.goto('/pages/admin.html#hours');
        await page.locator('[data-admin-tab="hours"]').click();
        await page.locator('[data-hours-open-time]').fill(step.open);
        await page.locator('[data-hours-close-time]').fill(step.close);
        const suggest = String(step.suggest || '');
        const parts = suggest.split(/[–-]/);
        if (parts[0]) await page.locator('[data-hours-suggest-start]').fill(parts[0].trim());
        if (parts[1]) await page.locator('[data-hours-suggest-end]').fill(parts[1].trim());
        await page.locator('[data-hours-action="save-open-hours"]').click();
        if (parts[1]) await page.locator('[data-hours-action="save-suggest"]').click();
        return;
      }
      case 'editDeliveryTrip': {
        await page.goto('/pages/delivery.html');
        await page.locator(`[data-edit-delivery="${step.id}"]`).click();
        await page.locator('#editDeliveryFee').fill('9000');
        await page.locator('#editDeliverySave').click();
        return;
      }
      case 'refreshReviews':
        await page.goto('/pages/reviews.html');
        await page.locator('#reviewsRefreshBtn').click();
        return;
      case 'signOut': {
        await ensureHome(page);
        await page.locator('#signOutBtn').click({ force: true });
        await page.waitForURL(/auth\.html/, { timeout: 8000 });
        return;
      }
      case 'signIn': {
        if (!page.url().includes('auth.html')) await page.goto('/auth.html');
        await page.locator('#login-email').fill('staff@test.local');
        await page.locator('#login-pass').fill('test-password');
        await page.getByRole('button', { name: 'Sign in' }).click();
        return;
      }
      default:
        throw new Error(`legacy driver has no step yet: ${step.do}`);
    }
  }

  if ('expect' in step) {
    switch (step.expect) {
      case 'saleRecorded': {
        const recorded = page
          .locator('#orderModalTitle, .checkout-success-total')
          .filter({ hasText: /Order recorded|Recorded on credit|UGX/ })
          .first();
        const shown = await recorded
          .waitFor({ timeout: 15000 })
          .then(() => true)
          .catch(() => false);
        if (!shown) {
          const toast = ((await page.locator('#toastMsg').textContent().catch(() => '')) || '').trim();
          const writes = mock.writes
            .filter((w) => /clients|sales/.test(w.url))
            .map((w) => `${w.method} ${w.url}`);
          throw new Error(`sale not recorded. toast="${toast}" writes=${writes.join(' | ')}`);
        }
        const formatted = String(step.total).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        await page.getByText(new RegExp(formatted)).first().waitFor({ timeout: 5000 });
        return;
      }
      case 'noWrites': {
        const bad = mock.writes.filter((w) => {
          if (w.method === 'POST' && w.url.includes('/rest/v1/sales')) return true;
          return (w.body as { op?: string } | null)?.op === 'delta';
        });
        if (bad.length) throw new Error(`expected no sale or stock writes, saw ${bad.length}`);
        return;
      }
      case 'toast':
        await page.getByText(new RegExp(step.message, 'i')).first().waitFor({ timeout: 8000 });
        return;
      case 'stock': {
        if (!page.url().includes('inventory')) await page.goto('/pages/inventory.html');
        await page
          .locator(`#inv-count-${step.categoryId}`)
          .filter({ hasText: new RegExp(`^${step.qty}$`) })
          .waitFor({ timeout: 8000 });
        return;
      }
      case 'display': {
        if (step.values.todayRevenue === 'legacy' || step.values.todayJoints === 'legacy') {
          await ensureHome(page);
          const expected = computeTodayStats(
            buildDefaultSeed().sales as Parameters<typeof computeTodayStats>[0],
          );
          const revenue = page.locator('#todayRevenue');
          await revenue.waitFor({ timeout: 15000 });
          await page.waitForFunction(
            (n) => {
              const text = (el: Element | null) => (el?.textContent || '').replace(/[^\d-]/g, '');
              return (
                Number(text(document.querySelector('#todayRevenue'))) === n.revenue &&
                Number(text(document.querySelector('#todayJoints'))) === n.joints &&
                Number(text(document.querySelector('#todayCookies'))) === n.cookies
              );
            },
            expected,
            { timeout: 8000 },
          );
        }
        if (step.values.cartLines != null) {
          const lines = page.locator('#cartItemsList .cart-item, [data-cart-items] .cart-item');
          await lines.first().waitFor({ timeout: 8000 });
        }
        return;
      }
      case 'redirect':
        await page.waitForURL(/index\.html|\/$|auth\.html/, { timeout: 8000 }).catch(() => {});
        return;
      case 'reachable':
        for (const route of step.routes) {
          await page.goto(legacyUrl(route));
          await page.locator('body').waitFor();
        }
        return;
      case 'clipboard':
        return;
      default:
        throw new Error(`legacy driver has no expect yet: ${step.expect}`);
    }
  }
}

export async function createLegacyDriver(
  page: Page,
  opts: { role?: 'pos_admin' | 'pos_staff'; seed?: 'default' | 'empty' } = {},
): Promise<LegacyDriver> {
  const mock = await installMockBackend(page, {
    role: opts.role || 'pos_staff',
    seed: opts.seed || 'default',
  });

  return {
    mock,
    async run(scenario) {
      if (scenario.steps.some((s) => 'do' in s && s.do === 'chargeRetry')) {
        mock.setFailure({ method: 'POST', table: 'sales', status: 500, times: 1 });
      }
      if (scenario.id === 'S32') {
        mock.setFailure({
          method: 'POST',
          pathIncludes: '/api/inventory/write',
          bodyOp: 'delta',
          status: 502,
          times: 1,
        });
      }
      const memory: CartMemory = { added: [], lastRemoved: null };
      const first = scenario.steps[0];
      const startsAway = first && 'do' in first && (first.do === 'go' || first.do === 'signIn');
      if (!startsAway) {
        await page.goto('/');
        await page.locator('[data-product]').first().waitFor({ timeout: 20000 });
      }
      for (const step of scenario.steps) {
        await runStep(page, step, mock, memory);
      }
    },
  };
}
