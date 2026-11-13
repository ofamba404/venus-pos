/**
 * The partial / full cookie partner send and the store-account loader, against a stubbed fetch.
 * Never touches a real server.
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authSession } from '../../src/data/auth';
import { sendPartnerBatch } from '../../src/data/partner-send';
import { loadStoreAccounts, STORE_ACCOUNT_PAGE, storeAccounts } from '../../src/data/store-accounts';
import type { PartnerSendPlan } from '../../src/domain/partner-send';

const plan = (count: number, kind: 'ready' | 'partial' = 'partial'): PartnerSendPlan => ({
  kind,
  count,
  index: 2,
  queued: 0,
  batch: { index: 2, cookieCount: count, every: 25, complete: count === 25, revenue: 0, ownerSplit: 0, partnerDue: 0, lines: [] },
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Handler = (method: string, body: string) => Response | Promise<Response>;
let handler: Handler;
const calls: Array<{ method: string; url: string; body: string }> = [];

beforeEach(() => {
  calls.length = 0;
  authSession.value = { access_token: 'tok', refresh_token: 'r', expires_at: 9_999_999_999, user: {} } as never;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const body = String(init?.body || '');
    calls.push({ method, url, body });
    return handler(method, body);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  authSession.value = null;
});

const posts = () => calls.filter((c) => c.method === 'POST');

describe('sendPartnerBatch', () => {
  it('sends a partial as one higher total with the partial cut, then reports the server state', async () => {
    handler = (method) =>
      method === 'GET'
        ? json(200, { ok: true, settled_qty: 25, batches: [25] })
        : json(200, { ok: true, applied: true, settled_qty: 31, batches: [25, 6] });
    const result = await sendPartnerBatch(plan(6), { qty: 25, batches: [25] });
    expect(result).toEqual({ ok: true, state: { qty: 31, batches: [25, 6] } });
    expect(JSON.parse(posts()[0]!.body)).toEqual({ settled_qty: 31, batches: [25, 6], qty_before: 25 });
  });

  it('rebuilds cuts when the server list does not add up, and keeps its own cuts when it does not echo them', async () => {
    handler = (method) =>
      method === 'GET'
        ? json(200, { ok: true, settled_qty: 30, batches: [] })
        : json(200, { ok: true, settled_qty: 55 });
    const result = await sendPartnerBatch(plan(25, 'ready'), { qty: 30, batches: [] });
    expect(result).toEqual({ ok: true, state: { qty: 55, batches: [25, 5, 25] } });
  });

  it('writes nothing when signed out, offline, or already behind another device', async () => {
    handler = () => json(200, { ok: true, settled_qty: 25, batches: [25] });
    authSession.value = null;
    expect(await sendPartnerBatch(plan(6), { qty: 25, batches: [25] })).toEqual({ ok: false, reason: 'auth' });
    expect(calls).toHaveLength(0);

    authSession.value = { access_token: 'tok' } as never;
    handler = () => json(500, {});
    expect(await sendPartnerBatch(plan(6), { qty: 25, batches: [25] })).toEqual({ ok: false, reason: 'offline' });

    handler = () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await sendPartnerBatch(plan(6), { qty: 25, batches: [25] })).toEqual({ ok: false, reason: 'offline' });

    handler = () => json(200, { ok: true, settled_qty: 31, batches: [25, 6] });
    expect(await sendPartnerBatch(plan(6), { qty: 25, batches: [25] })).toEqual({
      ok: false,
      reason: 'stale',
      state: { qty: 31, batches: [25, 6] },
    });
    expect(posts()).toHaveLength(0);
  });

  it('reports a refused write, a bad body, a network drop on the write, and a server that kept its total', async () => {
    const get = json(200, { ok: true, settled_qty: 25, batches: [25] });
    handler = (method) => (method === 'GET' ? get.clone() : json(503, {}));
    expect(await sendPartnerBatch(plan(6), { qty: 25, batches: [25] })).toEqual({ ok: false, reason: 'http', status: 503 });

    handler = (method) => (method === 'GET' ? get.clone() : json(200, { ok: false }));
    expect(await sendPartnerBatch(plan(6), { qty: 25, batches: [25] })).toMatchObject({ ok: false, reason: 'http' });

    handler = (method) => {
      if (method === 'GET') return get.clone();
      throw new TypeError('Failed to fetch');
    };
    expect(await sendPartnerBatch(plan(6), { qty: 25, batches: [25] })).toEqual({ ok: false, reason: 'offline' });

    handler = (method) => (method === 'GET' ? get.clone() : json(200, { ok: true, applied: false, settled_qty: 25, batches: [25] }));
    expect(await sendPartnerBatch(plan(6), { qty: 25, batches: [25] })).toEqual({
      ok: false,
      reason: 'stale',
      state: { qty: 25, batches: [25] },
    });
  });

  it('never sends zero cookies', async () => {
    handler = () => json(200, {});
    expect(await sendPartnerBatch(plan(0), { qty: 25, batches: [25] })).toEqual({ ok: false, reason: 'nothing' });
    expect(calls).toHaveLength(0);
  });
});

describe('loadStoreAccounts', () => {
  const isEdge = () => calls.at(-1)!.url.includes('/functions/v1/store-auth');

  it('asks the store-auth admin action first, like v1, and uses every user it returns', async () => {
    const users = [{ id: 'a1', phone: '0700111111' }, { id: 'a2', phone: '0700222222' }];
    handler = () => json(200, { users });
    const rows = await loadStoreAccounts();
    expect(rows).toEqual(users);
    expect(storeAccounts.value).toEqual(users);
    expect(calls).toHaveLength(1);
    expect(isEdge()).toBe(true);
    expect(JSON.parse(calls[0]!.body)).toEqual({ action: 'admin_list_users' });
  });

  it('falls back to the table, paging until a short page, when the action is refused', async () => {
    const full = Array.from({ length: STORE_ACCOUNT_PAGE }, (_, i) => ({ id: `a${i}`, phone: `07${i}` }));
    handler = () => {
      if (isEdge()) return json(403, { error: 'forbidden' });
      return json(200, calls.filter((c) => !c.url.includes('/functions/')).length === 1 ? full : [{ id: 'last', phone: '0700000000' }]);
    };
    const rows = await loadStoreAccounts();
    expect(rows).toHaveLength(STORE_ACCOUNT_PAGE + 1);
    expect(storeAccounts.value).toHaveLength(STORE_ACCOUNT_PAGE + 1);
    const tableCalls = calls.filter((c) => !c.url.includes('/functions/')).map((c) => c.url);
    expect(tableCalls).toEqual([
      expect.stringContaining(`limit=${STORE_ACCOUNT_PAGE}&offset=0`),
      expect.stringContaining(`limit=${STORE_ACCOUNT_PAGE}&offset=${STORE_ACCOUNT_PAGE}`),
    ]);
  });

  it('falls back to the table when the action cannot be reached at all', async () => {
    handler = () => {
      if (isEdge()) throw new TypeError('Failed to fetch');
      return json(200, [{ id: 'x', phone: '0700000001' }]);
    };
    expect(await loadStoreAccounts()).toEqual([{ id: 'x', phone: '0700000001' }]);
  });

  it('throws when neither the action nor the table can be read', async () => {
    handler = () => json(500, {});
    await expect(loadStoreAccounts()).rejects.toThrow(/Could not load storefront accounts \(500\)/);
  });
});
