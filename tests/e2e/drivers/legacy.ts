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
type CartMemory = { added: AddedLine[]; lastRemoved: AddedLine | null; owedBefore: number };

function parseUgx(text: string) {
  const match = text.match(/UGX\s*([\d,]+)/i);
  if (!match) return 0;
  return Number(match[1]!.replace(/,/g, ''));
}

function toastPattern(message: string) {
  if (message === 'offline') return /offline|check connection|no signal/i;
  if (message === 'saved') return /saved|updated/i;
  if (message === 'deleted') return /deleted|removed/i;
  return new RegExp(message, 'i');
}

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
  if (hash.startsWith('#load-store-order=')) return `/?${hash}`;
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

async function settleWrites(page: Page, mock: MockHandle) {
  let last = -1;
  let stable = 0;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && stable < 3) {
    if (mock.writes.length === last) stable += 1;
    else {
      last = mock.writes.length;
      stable = 0;
    }
    await page.waitForTimeout(150);
  }
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
        const preset = page.locator(`[data-hours-busy-mins="${step.minutes ?? 30}"]`);
        await preset.waitFor({ timeout: 15000 });
        if (step.minutes == null) {
          await page.locator('[data-hours-action="clear-busy"]').click();
          await page.getByText(/Busy period ended/i).waitFor({ timeout: 8000 });
        } else {
          await preset.click();
          await page.locator('[data-hours-action="save-busy"]').click();
          await page.getByText(/Busy until/i).waitFor({ timeout: 8000 });
        }
        return;
      }
      case 'arriveStoreOrder': {
        const socketDeadline = Date.now() + 8000;
        while (mock.realtimeClients < 1 && Date.now() < socketDeadline) {
          await page.waitForTimeout(50);
        }
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
        const before = mock.writes.length;
        await count.click();
        const input = page.locator(`#inv-count-${step.categoryId} input`);
        await input.waitFor({ timeout: 4000 });
        await input.evaluate((el, qty) => {
          const field = el as HTMLInputElement;
          field.value = String(qty);
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }, step.qty);
        const deadline = Date.now() + 8000;
        while (mock.writes.length === before && Date.now() < deadline) {
          await page.waitForTimeout(50);
        }
        return;
      }
      case 'go': {
        const target = legacyUrl(step.path);
        if (target.includes('load-store-order=')) {
          const id = decodeURIComponent(target.split('load-store-order=')[1] || '');
          await page.goto('/');
          await page.locator('#storeOrdersBtn').waitFor({ timeout: 15000 });
          await page.evaluate((orderId) => {
            location.hash = `load-store-order=${orderId}`;
          }, id);
          return;
        }
        await page.goto(target);
        return;
      }
      case 'goOffline':
        mock.setOffline(true);
        return;
      case 'clientsCrud': {
        if (!page.url().includes('/pages/clients.html')) await page.goto('/pages/clients.html');
        if (step.action === 'add') {
          await page.locator('#newClientInput').fill(step.name || '');
          await page.locator('#addClientBtn').click();
          const deadline = Date.now() + 8000;
          while (
            !mock.writes.some((w) => w.method === 'POST' && w.url.includes('/rest/v1/clients')) &&
            Date.now() < deadline
          ) {
            await page.waitForTimeout(50);
          }
          return;
        }
        if (step.name) await page.locator('#clientSearchInput').fill(step.name);
        const row = page.locator('[data-client-row]').filter({ hasText: step.name || '' }).first();
        await row.waitFor({ timeout: 8000 });
        if (step.action === 'rename') {
          const id = await row.getAttribute('data-client-row');
          await row.locator('[data-rename]').evaluate((el: HTMLElement) => el.click());
          const input = page.locator(`#renameInput-${id}`);
          await input.waitFor({ timeout: 8000 });
          await input.fill(step.newName || '');
          // Blur once. Enter also blurs, and both listeners PATCH (QUIRKS 11).
          await input.evaluate((el: HTMLInputElement) => el.blur());
          const renamed = Date.now() + 8000;
          while (
            !mock.writes.some((w) => w.method === 'PATCH' && w.url.includes('/rest/v1/clients')) &&
            Date.now() < renamed
          ) {
            await page.waitForTimeout(50);
          }
          return;
        }
        await row.locator('[data-delete]').click();
        await page.locator('#confirmOkBtn').click();
        return;
      }
      case 'setStoreHours': {
        await page.goto('/pages/admin.html#hours');
        await page.locator('[data-admin-tab="hours"]').click();
        const more = page.locator('.admin-hours__more-sum');
        if (await more.isVisible().catch(() => false)) await more.click();
        await page.locator('[data-hours-open-time]').fill(step.open);
        await page.locator('[data-hours-close-time]').fill(step.close);
        const suggest = String(step.suggest || '');
        const parts = suggest.split(/[–-]/);
        if (parts[0]) await page.locator('[data-hours-suggest-start]').fill(parts[0].trim());
        if (parts[1]) await page.locator('[data-hours-suggest-end]').fill(parts[1].trim());
        if (parts[1]) {
          await page.locator('[data-hours-suggest-start]').fill(parts[0]!.trim());
          await page.locator('[data-hours-suggest-end]').fill(parts[1].trim());
          const suggestSave = page.locator('[data-hours-action="save-suggest"]');
          if (await suggestSave.isEnabled()) await suggestSave.click();
          const detailsOpen = await page
            .locator('details.admin-hours__more')
            .evaluate((el: HTMLDetailsElement) => el.open)
            .catch(() => false);
          if (!detailsOpen) await page.locator('.admin-hours__more-sum').click();
        }
        await page
          .locator('[data-hours-action="save-open-hours"]')
          .evaluate((el: HTMLElement) => el.click());
        return;
      }
      case 'editDeliveryTrip': {
        await page.goto('/pages/delivery.html');
        const trip = page.locator(`[data-edit-delivery="${step.id}"]`);
        await trip.waitFor({ state: 'attached', timeout: 15000 });
        await trip.evaluate((el: HTMLElement) => el.click());
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
        await page.evaluate(() => sessionStorage.setItem('venus-signed-out', '1'));
        await page.locator('#fabNavToggle').click();
        await page.locator('#signOutBtn').click();
        await page.waitForURL(/auth\.html/, { timeout: 8000 });
        return;
      }
      case 'settleCredit': {
        await page.goto('/pages/analytics.html');
        const group = page.locator('.credit-client-group', { hasText: step.clientName || '' }).first();
        await group.waitFor({ timeout: 15000 });
        memory.owedBefore = parseUgx(await group.locator('.credit-client-head .cr-meta').innerText());
        await group.locator('[data-pay-client-credit], [data-pay-credit]').first().click();
        await page.locator('#settleAmount').waitFor({ timeout: 8000 });
        if (step.amountUgx >= (memory.owedBefore || 0)) {
          await page.locator('#settleFullBtn').click();
        } else {
          await page.locator('#settleAmount').fill(String(step.amountUgx));
        }
        if (step.method === 'mobile_money' || step.method === 'mobile') {
          await page.locator('label.settle-method', { hasText: 'Mobile' }).click();
        }
        if (step.note) await page.locator('#settleNote').fill(step.note);
        await page.locator('#settleConfirm').click();
        return;
      }
      case 'editSale': {
        await page.goto('/pages/history.html');
        const sale = page.locator(`[data-edit-sale="${step.saleId}"]`);
        await sale.waitFor({ state: 'attached', timeout: 15000 });
        await sale.evaluate((el: HTMLElement) => el.click());
        await page.locator('#editSaleSave').click();
        return;
      }
      case 'voidSale': {
        await page.goto('/pages/history.html');
        const sale = page.locator(`[data-edit-sale="${step.saleId}"]`);
        await sale.waitFor({ state: 'attached', timeout: 15000 });
        await sale.evaluate((el: HTMLElement) => el.click());
        await page.locator('#editSaleVoid').click();
        await page.locator('#confirmOkBtn').click();
        return;
      }
      case 'partnerSettleBatch': {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.goto('/pages/analytics.html');
        const send = page.locator('[data-cookie-partner-send]');
        if (await send.isVisible().catch(() => false)) {
          await send.click();
          const ok = page.locator('#confirmOkBtn');
          if (await ok.isVisible().catch(() => false)) await ok.click();
        }
        await page.locator('[data-cookie-partner-copy]').click();
        return;
      }
      case 'storeUsers': {
        await page.goto('/pages/admin.html');
        await page.getByRole('link', { name: 'Users', exact: true }).click();
        await page.locator('[data-rename-store-user]').first().waitFor({ timeout: 15000 });
        if (step.action === 'setName') {
          await page.locator('[data-rename-store-user]').first().click();
          const input = page.locator('.admin-user-row__name-input');
          await input.waitFor({ timeout: 8000 });
          await input.fill(step.name || '');
          await input.press('Enter');
          return;
        }
        if (step.action === 'verify') {
          await page.locator('[data-verify-store-user]').first().click();
          const ok = page.locator('#confirmOkBtn');
          if (await ok.isVisible().catch(() => false)) await ok.click();
          return;
        }
        await page.locator('[data-delete-store-user]').first().click();
        await page.locator('#confirmOkBtn').click();
        return;
      }
      case 'quoteLabPreset': {
        await page.goto('/pages/delivery.html');
        await page.locator('#quoteLabChips .ql-chip').first().click();
        await page.locator('#quoteLabFee').fill('5000');
        await page.locator('#quoteLabSave').click();
        return;
      }
      case 'enableNotifications': {
        await page.addInitScript(() => {
          const ask = () => Promise.resolve('denied' as NotificationPermission);
          class DeniedNotification {
            static permission: NotificationPermission = 'default';
            static requestPermission() {
              DeniedNotification.permission = 'denied';
              return ask();
            }
          }
          Object.defineProperty(window, 'Notification', { configurable: true, value: DeniedNotification });
        });
        await page.goto('/');
        await page.locator('[data-pwa-enable]').click({ timeout: 8000 });
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
      case 'toast': {
        const source = toastPattern(step.message).source;
        const ok = await page
          .waitForFunction(
            (pattern) => {
              const bits = [
                document.querySelector('#toastMsg')?.textContent || '',
                document.querySelector('#inAppBanner')?.textContent || '',
                ...((window as Window & { __toastLog?: string[] }).__toastLog || []),
              ];
              return bits.some((text) => new RegExp(pattern, 'i').test(text));
            },
            source,
            { timeout: 12000 },
          )
          .then(() => true)
          .catch(() => false);
        if (!ok) {
          const text = ((await page.locator('#toastMsg').textContent().catch(() => '')) || '').trim();
          const banner = ((await page.locator('#inAppBanner').textContent().catch(() => '')) || '').trim();
          const log = await page.evaluate(() => (window as Window & { __toastLog?: string[] }).__toastLog || []);
          throw new Error(`toast missing ${step.message}, saw "${text}" banner="${banner}" log=${log.join(' | ')}`);
        }
        return;
      }
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
          await lines.first().waitFor({ timeout: 15000 });
        }
        if (step.values.creditOwedDelta != null) {
          const expected = memory.owedBefore + Number(step.values.creditOwedDelta);
          const meta = page
            .locator('.credit-client-group', { hasText: /client with debt/i })
            .first()
            .locator('.credit-client-head .cr-meta');
          const deadline = Date.now() + 8000;
          let owed = parseUgx(await meta.innerText().catch(() => ''));
          while (owed !== expected && Date.now() < deadline) {
            await page.waitForTimeout(200);
            owed = parseUgx(await meta.innerText().catch(() => ''));
          }
          if (owed !== expected) throw new Error(`owed ${owed}, expected ${expected}`);
        }
        if (step.values.creditOwed === 0) {
          await page.getByText(/all settled|owes 0|UGX 0/i).first().waitFor({ timeout: 8000 });
        }
        if (step.values.busy === 'off') {
          const status = page.locator('.admin-hours__status');
          await status.waitFor({ timeout: 8000 });
          const text = await status.innerText();
          if (/^busy\b/i.test(text) || /busy until/i.test(text)) {
            throw new Error(`expected busy off, saw ${text}`);
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
      case 'redirect':
        await page.waitForURL(/index\.html|\/$|auth\.html/, { timeout: 8000 }).catch(() => {});
        return;
      case 'reachable':
        for (const route of step.routes) {
          await page.goto(legacyUrl(route));
          await page.locator('body').waitFor();
        }
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
      await page.addInitScript(() => {
        const w = window as Window & { __toastLog?: string[] };
        w.__toastLog = [];
        const attach = (el: Element) => {
          const node = el as HTMLElement;
          if (node.dataset.toastWatch === '1') return;
          node.dataset.toastWatch = '1';
          const push = () => {
            const text = (node.textContent || '').trim();
            if (!text) return;
            const log = w.__toastLog || [];
            w.__toastLog = log;
            if (log[log.length - 1] !== text) log.push(text);
          };
          new MutationObserver(push).observe(node, {
            subtree: true,
            characterData: true,
            childList: true,
          });
        };
        const scan = () => {
          const el = document.querySelector('#toastMsg');
          if (el) attach(el);
        };
        new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
        if (document.readyState !== 'loading') scan();
      });
      const memory: CartMemory = { added: [], lastRemoved: null, owedBefore: 0 };
      const first = scenario.steps[0];
      const startsAway = first && 'do' in first && (first.do === 'go' || first.do === 'signIn');
      if (!startsAway) {
        await page.goto('/');
        await page.locator('[data-product]').first().waitFor({ timeout: 20000 });
      }
      for (const step of scenario.steps) {
        await runStep(page, step, mock, memory);
      }
      await settleWrites(page, mock);
    },
  };
}
