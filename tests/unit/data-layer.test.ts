/**
 * Data-layer paths: writes, checkout, auth refresh, and entity loads.
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultOrderMeta, type CartLine, type OrderMeta } from '../../src/domain/cart';
import {
  authRole,
  canAccessPath,
  getAccessToken,
  hydrateAuth,
  isAdmin,
  peekAccessToken,
  refreshNow,
  signIn,
  signOut,
  writeStoredSession,
} from '../../src/data/auth';
import { functionFetch, sbFetch } from '../../src/data/api';
import { runCheckout } from '../../src/data/checkout';
import { clearCheckoutDraft, replaceCheckoutDraft, setCheckoutDraft } from '../../src/data/checkout-draft';
import { ensureDeliveryModel, predictFeeForDest } from '../../src/data/delivery-model';
import { deviceId } from '../../src/data/device-id';
import {
  adjustInventory,
  applyCachedEntity,
  bootstrapEntities,
  clients,
  deliveries,
  ensureInventory,
  inventory,
  loadClients,
  loadDeliveries,
  loadSales,
  loadStoreOrders,
  sales,
  setInventoryCount,
  storeOrders,
  syncLabel,
} from '../../src/data/entities';
import { resetFreshnessForTests } from '../../src/data/freshness';
import { deleteHeld, listHeld, saveHeld } from '../../src/data/held';
import { resetPosDbForTests } from '../../src/data/idb';
import { KEYS } from '../../src/data/keys';
import { enqueueSale, flushOutbox, listOutbox, removeOutbox } from '../../src/data/outbox';
import { readConnection, scheduleIdlePrefetch, shouldSkipPrefetch, staleEntities } from '../../src/data/prefetch';
import { connectSupabaseRealtime } from '../../src/data/realtime';
import {
  addPlainLine,
  bumpFirstLine,
  mergeBreakdown,
  removeSaleLine,
  saleItems,
  saveSaleEdit,
  saveSaleItems,
  setLineQty,
  voidSaleRecord,
} from '../../src/data/sale-edit';
import { clearCartKeepMeta, dispatchCart, readStoredCart, replaceCart } from '../../src/data/session-cart';
import { postStoreReserve } from '../../src/data/store-reserve';
import { postClient } from '../../src/data/writes/clients';
import { postCreditPayment } from '../../src/data/writes/credit';
import { patchDelivery, postDelivery } from '../../src/data/writes/deliveries';
import { patchInventoryStock } from '../../src/data/writes/inventory';
import { fetchCookiePartnerSettle, postCookiePartnerSettle } from '../../src/data/writes/partner';
import { deleteSale, patchSale, postSale } from '../../src/data/writes/sales';
import { patchStoreOrder } from '../../src/data/writes/store-orders';
import { deleteStoreAccount, patchFulfillment, patchStoreAccount, storeAuth } from '../../src/data/writes/store';
import { installFakeIndexedDb } from './fake-idb';

type Mode = {
  saleStatus: number;
  saleBody: unknown;
  ensureRows: Array<{ category_id: string; stock: number }>;
  deltaStatus: number;
  reserve: { status: number; body: unknown } | 'throw';
  salesGet: unknown;
  openCredit: unknown;
};

const mode: Mode = {
  saleStatus: 201,
  saleBody: [{ id: 'sale-new', total_ugx: 8000 }],
  ensureRows: [{ category_id: 'mint', stock: 20 }],
  deltaStatus: 200,
  reserve: { status: 200, body: { ok: true, consumed: true, claimed: { mint: 1 } } },
  salesGet: [{ id: 'sale-old', total_ugx: 8000, created_at: '2026-11-01T00:00:00.000Z' }],
  openCredit: [],
};

function json(status: number, body: unknown) {
  if (status === 204) return new Response(null, { status: 204 });
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function line(): CartLine {
  return {
    key: 'l1',
    productId: 'scout',
    name: 'Scout Pack',
    detail: 'Mint x1',
    breakdown: { mint: 1 },
    lineTotal: 8000,
  };
}

function meta(patch: Partial<OrderMeta> = {}): OrderMeta {
  return { ...defaultOrderMeta(), clientName: 'Test Client A', clientId: 'client-a', deliveryEnabled: false, ...patch };
}

beforeEach(() => {
  installFakeIndexedDb();
  resetPosDbForTests();
  resetFreshnessForTests();
  mode.saleStatus = 201;
  mode.saleBody = [{ id: 'sale-new', total_ugx: 8000 }];
  mode.ensureRows = [{ category_id: 'mint', stock: 20 }];
  mode.deltaStatus = 200;
  mode.reserve = { status: 200, body: { ok: true, consumed: true, claimed: { mint: 1 } } };
  mode.salesGet = [{ id: 'sale-old', total_ugx: 8000, created_at: '2026-11-01T00:00:00.000Z' }];
  mode.openCredit = [];
  clients.value = [{ id: 'client-a', name: 'Test Client A' }];
  sales.value = [];
  deliveries.value = [];
  storeOrders.value = [];
  localStorage.setItem(
    KEYS.auth,
    JSON.stringify({
      access_token: 'header.payload.sig',
      refresh_token: 'refresh-v1',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { email: 'owner@venus.test', app_metadata: { role: 'pos_admin' } },
    }),
  );
  hydrateAuth();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const body = typeof init?.body === 'string' ? init.body : '';
    if (url.includes('grant_type=password')) {
      return json(200, {
        access_token: 'signed-in',
        refresh_token: 'r2',
        expires_in: 3600,
        user: { app_metadata: { role: 'pos_staff' } },
      });
    }
    if (url.includes('grant_type=refresh_token')) {
      if (url.includes('boom')) return json(401, { error: 'no' });
      return json(200, {
        access_token: 'refreshed',
        refresh_token: 'r3',
        expires_in: 120,
        user: { app_metadata: { role: 'pos_admin' } },
      });
    }
    if (url.includes('/api/inventory/write')) {
      const parsed = JSON.parse(body || '{}') as { op?: string };
      if (parsed.op === 'ensure') return json(200, { ok: true, rows: mode.ensureRows });
      return json(mode.deltaStatus, mode.deltaStatus >= 400 ? { error: 'down' } : { ok: true });
    }
    if (url.includes('/api/store-order/reserve')) {
      if (mode.reserve === 'throw') throw new TypeError('Failed to fetch');
      return json(mode.reserve.status, mode.reserve.body);
    }
    if (url.includes('/api/cookie-partner/settle')) {
      if (url.includes('bad-settle')) return json(500, { ok: false });
      if (url.includes('empty-settle')) return json(200, { ok: false });
      if (method === 'GET') return json(200, { ok: true, settled_qty: 262, batches: [25, 'nope', 0] });
      return json(200, { ok: true, settled_qty: 285 });
    }
    if (url.includes('/functions/v1/store-auth')) {
      if (url.includes('bad-auth')) return json(400, { error: 'no' });
      return json(200, { code: 'ABCD-2345' });
    }
    if (url.includes('/rest/v1/sales') && method === 'POST') return json(mode.saleStatus, mode.saleBody);
    if (url.includes('/rest/v1/clients') && method === 'POST') return json(201, [{ id: 'client-new', name: 'New Person' }]);
    if (url.includes('/rest/v1/deliveries') && method === 'POST') return json(201, [{ id: 'trip-1' }]);
    if (url.includes('is_credit=eq.true')) return json(200, mode.openCredit);
    if (url.includes('/rest/v1/sales') && method === 'GET') return json(200, mode.salesGet);
    if (url.includes('/rest/v1/clients')) return json(200, [{ id: 'client-a', name: 'Test Client A' }]);
    if (url.includes('/rest/v1/deliveries') && method === 'GET') {
      return json(200, [{ id: 'd1', fee_ugx: 4000, distance_km: 2, duration_min: 10, created_at: '2026-11-12T08:00:00+03:00' }]);
    }
    if (url.includes('/rest/v1/store_orders') && method === 'GET') return json(200, [{ id: 'ord-1', status: 'pending' }]);
    if (url.includes('/rest/v1/inventory') && method === 'PATCH') return json(204, null);
    if (method === 'PATCH' || method === 'DELETE') return json(204, null);
    return json(200, []);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('data layer', () => {
  it('signs in, refreshes an expiring session, and limits staff routes', async () => {
    expect(isAdmin()).toBe(true);
    expect(canAccessPath('/insights')).toBe(true);
    expect(peekAccessToken()).toBe('header.payload.sig');
    const signed = await signIn('owner@venus.test', 'secret');
    expect(signed.access_token).toBe('signed-in');
    expect(authRole.value).toBe('pos_staff');
    expect(canAccessPath('/sell')).toBe(true);
    expect(canAccessPath('/insights')).toBe(false);
    authSessionSetExpiry(30);
    const token = await getAccessToken();
    expect(token).toBe('refreshed');
    await refreshNow();
    signOut();
    expect(peekAccessToken()).toBe('');
    expect(readStoredSessionSafe()).toBeNull();
    await expect(functionFetch('/api/inventory/write', { op: 'ensure' })).rejects.toThrow(/signed in/i);
    writeStoredSession({ access_token: 'header.payload.sig', user: { app_metadata: { pos_role: 'pos_admin' } } });
    hydrateAuth();
    expect(authRole.value).toBe('pos_admin');
  });

  it('posts the write helpers and reads merged sales', async () => {
    await postSale({ total_ugx: 8000 });
    await patchSale('sale-1', { total_ugx: 1 }, 'return=minimal');
    await deleteSale('sale-1');
    await postClient('New Person');
    await postCreditPayment({ client_id: 'client-a', amount_ugx: 1000, method: 'cash', note: null });
    await postDelivery({ fee_ugx: 3000 });
    await patchDelivery('d1', { fee_ugx: 4000 });
    await patchInventoryStock('mint', 21);
    await postCookiePartnerSettle(26);
    await patchStoreOrder('ord-1', { status: 'accepted' });
    await patchFulfillment({ busy_until: null });
    await patchStoreAccount('u1', { pos_display_name: 'A' });
    await deleteStoreAccount('u1');
    const res = await sbFetch('sales?select=*');
    expect(res.ok).toBe(true);
    expect(deviceId().length).toBeGreaterThan(4);
    expect(deviceId()).toBe(localStorage.getItem(KEYS.device));
  });

  it('checks out a paid sale, rolls a 500 back, and queues a 503', async () => {
    const paid = await runCheckout({ lines: [line()], meta: meta(), isCredit: false, clientId: 'client-a' });
    expect(paid.ok).toBe(true);
    if (paid.ok) expect(paid.sale.id).toBe('sale-new');

    mode.saleStatus = 500;
    mode.saleBody = { message: 'no' };
    const failed = await runCheckout({ lines: [line()], meta: meta(), isCredit: false, clientId: 'client-a' });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.restored).toBe(true);
    expect(inventory.value.mint).toBe(20);

    mode.saleStatus = 503;
    const queued = await runCheckout({ lines: [line()], meta: meta(), isCredit: false, clientId: 'client-a' });
    expect(queued.ok).toBe(true);
    if (queued.ok) expect(queued.queued).toBe(true);

    const empty = await runCheckout({ lines: [], meta: meta(), isCredit: false });
    expect(empty.ok).toBe(false);
    const nameless = await runCheckout({
      lines: [line()],
      meta: meta({ clientName: '', clientId: '' }),
      isCredit: false,
    });
    expect(nameless.ok).toBe(false);
    const creditWalk = await runCheckout({
      lines: [line()],
      meta: meta({ clientName: 'Walk-in', clientId: '' }),
      isCredit: true,
    });
    expect(creditWalk.ok).toBe(false);
  });

  it('refuses a second checkout, a short stock count, and a store hold with no signal', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/rest/v1/sales') && (init?.method || 'GET') === 'POST') await gate;
      return original(input, init);
    });
    const first = runCheckout({ lines: [line()], meta: meta(), isCredit: false, clientId: 'client-a' });
    const second = await runCheckout({ lines: [line()], meta: meta(), isCredit: false, clientId: 'client-a' });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/in progress/);
    release();
    await first;

    mode.ensureRows = [{ category_id: 'mint', stock: 0 }];
    resetFreshnessForTests();
    const short = await runCheckout({ lines: [line()], meta: meta(), isCredit: false, clientId: 'client-a' });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error).toMatch(/Not enough/);

    mode.ensureRows = [{ category_id: 'mint', stock: 20 }];
    mode.reserve = 'throw';
    resetFreshnessForTests();
    const offlineHold = await runCheckout({
      lines: [line()],
      meta: meta({ storeOrderId: 'ord-1' }),
      isCredit: false,
      clientId: 'client-a',
    });
    expect(offlineHold.ok).toBe(false);
  });

  it('creates a client, logs a delivery, and loads entities', async () => {
    clients.value = [];
    resetFreshnessForTests();
    const created = await runCheckout({
      lines: [line()],
      meta: meta({ clientName: 'New Person', clientId: '', deliveryEnabled: true }),
      isCredit: false,
      checkout: {
        dest: { lat: 0.33, lng: 32.58 },
        destText: 'Nakasero',
        feeValue: '5000',
        distanceKm: 3,
        durationMin: 12,
      },
    });
    expect(created.ok).toBe(true);
    expect(clients.value.some((c) => c.id === 'client-new')).toBe(true);

    await loadSales({ force: true });
    await loadClients({ force: true });
    await loadDeliveries({ force: true });
    await loadStoreOrders();
    expect(sales.value[0]?.id).toBe('sale-old');
    expect(storeOrders.value[0]?.id).toBe('ord-1');
    expect(syncLabel.value).toBe('live');

    mode.deltaStatus = 502;
    await adjustInventory('mint', 1);
    expect(inventory.value.mint).toBeGreaterThan(0);
    await setInventoryCount('mint', inventory.value.mint);
    mode.deltaStatus = 400;
    await expect(adjustInventory('strawberry', 1)).rejects.toThrow();

    await bootstrapEntities();
    applyCachedEntity('clients', [{ id: 'c2', name: 'B' }]);
    applyCachedEntity('deliveries', [{ id: 'd2' }]);
    applyCachedEntity('sales', 'nope');
  });

  it('edits and voids a sale, flushes the outbox, and parks a hold', async () => {
    const sale = {
      id: 'sale-1',
      is_credit: false,
      items: [{ product_id: 'scout', line_total: 8000, breakdown: { mint: 1 } }],
    };
    const nextItems = bumpFirstLine(saleItems(sale));
    expect(mergeBreakdown(nextItems).mint).toBe(2);
    // + on a pack adds another whole pack. It never multiplies the first flavour's count inside one.
    expect(nextItems).toHaveLength(2);
    expect(nextItems[0]?.breakdown).toEqual({ mint: 1 });
    expect(mergeBreakdown(setLineQty([{ product_id: 'plain_single', line_total: 5000, breakdown: { classic: 1 } }], 0, 3)).classic).toBe(3);
    expect(removeSaleLine(nextItems, 0)).toHaveLength(1);
    expect(addPlainLine([] )[0]?.product_id).toBe('plain_single');
    expect(setLineQty([{ line_total: 0 }], 0, 2)[0]?.line_total).toBe(0);
    mode.deltaStatus = 200;
    await saveSaleItems(sale, nextItems);
    await saveSaleEdit(sale, { items: nextItems, clientId: 'c1', isCredit: true, creditCleared: false });
    await saveSaleEdit(sale, { items: nextItems, clientId: null, isCredit: true, creditCleared: true });
    await voidSaleRecord({ ...sale, items: nextItems });
    const settled = await fetchCookiePartnerSettle();
    expect(settled).toEqual({ qty: 262, batches: [25] });
    await postCookiePartnerSettle(285, [25, 23], 262);
    expect(await storeAuth('admin_issue_reset_code', { user_id: 'acc-1' })).toMatchObject({
      ok: true,
      data: { code: 'ABCD-2345' },
    });

    await enqueueSale({
      clientSaleId: 'q1',
      body: { total_ugx: 8000, client_sale_id: 'q1' },
      deltas: { mint: 1 },
      createdAt: '2026-11-12T00:00:00.000Z',
      label: 'A',
    });
    const flushed = await flushOutbox();
    expect(flushed.synced).toBe(1);
    expect((await listOutbox()).some((row) => row.clientSaleId === 'q1')).toBe(false);

    mode.saleStatus = 400;
    mode.saleBody = { message: 'client_sale_id missing' };
    await enqueueSale({
      clientSaleId: 'q2',
      body: { total_ugx: 1 },
      deltas: {},
      createdAt: '2026-11-12T00:00:00.000Z',
      label: 'B',
    });
    const blocked = await flushOutbox();
    expect(blocked.blocked).toBe(true);
    await removeOutbox('q2');

    await saveHeld({
      id: 'h1',
      name: 'Parked',
      savedAt: '2026-11-12T10:00:00.000Z',
      lines: [line()],
      meta: meta(),
    });
    expect((await listHeld()).some((row) => row.id === 'h1')).toBe(true);
    await deleteHeld('h1');
    await saveHeld({ id: '', name: '', savedAt: '', lines: [], meta: meta() });
  });

  it('keeps the v1 cart, draft, prefetch hint, and fee estimate', async () => {
    sessionStorage.setItem(KEYS.cart, 'not-json');
    expect(readStoredCart().lines).toEqual([]);
    replaceCart([line()], { clientName: 'Amina' });
    clearCartKeepMeta();
    dispatchCart({ type: 'set_meta', meta: { isCredit: true } });
    setCheckoutDraft({ feeValue: '4000', destText: 'Kololo' });
    replaceCheckoutDraft({ dest: null, destText: 'K', feeValue: '1', distanceKm: null, durationMin: null });
    clearCheckoutDraft();
    sessionStorage.setItem(KEYS.fulfillment, '{');
    setCheckoutDraft({ feeValue: '2' });

    expect(shouldSkipPrefetch(null)).toBe(false);
    expect(shouldSkipPrefetch({ saveData: true })).toBe(true);
    expect(shouldSkipPrefetch({ effectiveType: '2g' })).toBe(true);
    expect(staleEntities(() => false)).toContain('sales');
    const cancel = scheduleIdlePrefetch(() => {});
    cancel();
    expect(readConnection()).toBeNull();

    const quote = predictFeeForDest({ lat: 0.34, lng: 32.58 }, { lat: 0.33, lng: 32.57 }, 4, 15);
    expect(quote.km).toBe(4);
    await ensureDeliveryModel();
    const reserve = await postStoreReserve({ op: 'claim', id: 'ord-1' });
    expect(reserve.ok).toBe(true);
    mode.reserve = { status: 404, body: {} };
    expect((await postStoreReserve({ op: 'claim', id: 'ord-1' })).unsupported).toBe(true);
    expect(connectSupabaseRealtime('')).toBeNull();
  });
});

function authSessionSetExpiry(secondsFromNow: number) {
  const current = JSON.parse(localStorage.getItem(KEYS.auth) || '{}');
  current.expires_at = Math.floor(Date.now() / 1000) + secondsFromNow;
  current.refresh_token = 'refresh-v1';
  localStorage.setItem(KEYS.auth, JSON.stringify(current));
  hydrateAuth();
}

function readStoredSessionSafe() {
  return localStorage.getItem(KEYS.auth);
}
