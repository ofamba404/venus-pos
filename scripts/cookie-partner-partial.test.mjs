import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { COOKIE_PARTNER_SETTLE_EVERY } from '../js/config.js';
import { COOKIE_SETTLE_BATCH_MAX, normalizeSettledBatches } from '../js/cookie-partner-batches.js';
import { PAGE_TEMPLATES, STAFF_PAGE_TEMPLATES } from '../js/pages/templates.js';

const mem = new Map();
globalThis.localStorage = {
  getItem: (key) => (mem.has(key) ? mem.get(key) : null),
  setItem: (key, value) => mem.set(key, String(value)),
  removeItem: (key) => mem.delete(key),
};
globalThis.window = {};

const {
  cookiePartnerSettlementSummary,
  getCookiePartnerSettledQty,
  markCookiePartnerBatchesSent,
  setCookiePartnerSettledQty,
} = await import('../js/revenue.js');

const QTY_KEY = 'venus-cookie-partner-settled-qty-v4';
const BATCH_KEY = 'venus-cookie-partner-settled-batches-v1';

function sale(id, qty, when) {
  return {
    id,
    created_at: when,
    total_ugx: qty * 5000,
    items: [
      {
        product_id: 'cookie_single',
        product_name: 'Butterscotch',
        line_total: qty * 5000,
        breakdown: { cookie_butterscotch: qty },
      },
    ],
  };
}

function salesOf(...qtys) {
  return qtys.map((qty, i) => sale(`s${i}`, qty, `2026-08-${String(13 + i).padStart(2, '0')}T12:00:00+03:00`));
}

function sentCounts(summary) {
  return summary.settledBatches.map((batch) => batch.cookieCount);
}

beforeEach(() => {
  mem.clear();
  setCookiePartnerSettledQty(25);
  delete window.VenusPosAuth;
  globalThis.fetch = async () => {
    throw new Error('settle API must not be called');
  };
});

test('full batch size stays 25', () => {
  assert.equal(COOKIE_PARTNER_SETTLE_EVERY, 25);
  assert.equal(COOKIE_SETTLE_BATCH_MAX, 25);
});

test('batch sizes reject 0, oversized, and sums that do not match settled qty', () => {
  assert.equal(normalizeSettledBatches([25, 0], 25), null);
  assert.equal(normalizeSettledBatches([26], 26), null);
  assert.equal(normalizeSettledBatches([25, 12], 40), null);
  assert.equal(normalizeSettledBatches([], 25), null);
  assert.deepEqual(normalizeSettledBatches([25, 12], 37), [25, 12]);
  assert.deepEqual(normalizeSettledBatches([25, 25], 50), [25, 25]);
});

test('in-progress batch can be sent for the cookies actually unsettled', async () => {
  const sales = salesOf(25, 12);
  const before = cookiePartnerSettlementSummary(sales);
  assert.equal(before.unsettledCount, 12);
  assert.equal(before.readyCount, 0);
  assert.equal(before.pages.at(-1).status, 'progress');
  assert.equal(before.pages.at(-1).cookieCount, 12);

  const after = await markCookiePartnerBatchesSent(sales, { partial: true });
  assert.equal(after.settledQty, 37);
  assert.equal(after.unsettledCount, 0);
  assert.deepEqual(sentCounts(after), [25, 12]);
  assert.equal(after.settledBatches.at(-1).status, 'sent');
  assert.equal(after.settledBatches.at(-1).partnerDue, before.pages.at(-1).partnerDue);
  assert.equal(after.pages.at(-1).status, 'progress');
  assert.equal(after.pages.at(-1).cookieCount, 0);
  assert.equal(after.towardNext, 0);
  assert.equal(getCookiePartnerSettledQty(), 37);
});

test('partial send does not call the settle API without a staff token', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('network');
  };
  await markCookiePartnerBatchesSent(salesOf(25, 8), { partial: true });
  assert.equal(calls, 0);
  assert.equal(getCookiePartnerSettledQty(), 33);
});

test('a later sale starts a new batch at the new cookies, and partial history is kept', async () => {
  const sales = salesOf(25, 12);
  await markCookiePartnerBatchesSent(sales, { partial: true });
  sales.push(sale('more', 8, '2026-09-02T12:00:00+03:00'));
  const open = cookiePartnerSettlementSummary(sales);
  assert.deepEqual(sentCounts(open), [25, 12]);
  assert.equal(open.unsettledCount, 8);
  assert.equal(open.pages.at(-1).cookieCount, 8);
  assert.equal(open.pages.at(-1).status, 'progress');

  await markCookiePartnerBatchesSent(sales, { partial: true });
  sales.push(sale('full', 25, '2026-09-03T12:00:00+03:00'));
  const ready = cookiePartnerSettlementSummary(sales);
  assert.equal(ready.readyCount, 25);
  assert.equal(ready.pages.some((page) => page.status === 'progress'), false);
  await markCookiePartnerBatchesSent(sales);
  const done = cookiePartnerSettlementSummary(sales);
  assert.deepEqual(sentCounts(done), [25, 12, 8, 25]);
  assert.equal(done.unsettledCount, 0);
  assert.equal(done.pages.at(-1).status, 'sent');
  assert.equal(done.pages.at(-1).cookieCount, 25);
});

test('full batches still send exactly 25 and a partial cannot skip ahead of one', async () => {
  const sales = salesOf(25, 30);
  const before = cookiePartnerSettlementSummary(sales);
  assert.equal(before.readyCount, 25);
  assert.equal(before.unsettledCount, 30);
  assert.equal(before.pages.find((page) => page.status === 'progress').cookieCount, 5);

  const blocked = await markCookiePartnerBatchesSent(sales, { partial: true });
  assert.equal(blocked.settledQty, 25);

  const after = await markCookiePartnerBatchesSent(sales);
  assert.equal(after.settledQty, 50);
  assert.equal(after.unsettledCount, 5);
  assert.equal(after.readyCount, 0);
  assert.deepEqual(sentCounts(after), [25, 25]);
  assert.equal(after.pages.find((page) => page.status === 'progress').cookieCount, 5);
});

test('nothing to send, and a catch-up qty is not posted to a blob that cannot store batches', async () => {
  const empty = await markCookiePartnerBatchesSent(salesOf(25), { partial: true });
  assert.equal(empty.settledQty, 25);
  assert.equal(empty.unsettledCount, 0);

  const posts = [];
  window.VenusPosAuth = {
    getAccessToken: async () => 'staff-token',
    peekAccessToken: () => 'staff-token',
  };
  globalThis.fetch = async (url, init) => {
    if (init?.method === 'POST') {
      posts.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ ok: true, settled_qty: posts.at(-1).settled_qty }) };
    }
    return { ok: true, json: async () => ({ ok: true, settled_qty: 25 }) };
  };

  const refused = await markCookiePartnerBatchesSent(salesOf(25, 4), { partial: true });
  assert.equal(posts.length, 0);
  assert.equal(refused.settledQty, 25);
  assert.equal(mem.get(QTY_KEY), '25');
  assert.equal(mem.has(BATCH_KEY), false);
});

test('a server that stores batch sizes receives the partial count, not a padded 25', async () => {
  const posts = [];
  window.VenusPosAuth = {
    getAccessToken: async () => 'staff-token',
    peekAccessToken: () => 'staff-token',
  };
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /\/api\/cookie-partner\/settle$/);
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body);
      posts.push(body);
      return {
        ok: true,
        json: async () => ({ ok: true, settled_qty: body.settled_qty, batches: body.batches }),
      };
    }
    return { ok: true, json: async () => ({ ok: true, settled_qty: 25, batches: [25] }) };
  };

  const after = await markCookiePartnerBatchesSent(salesOf(25, 9), { partial: true });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].settled_qty, 34);
  assert.deepEqual(posts[0].batches, [25, 9]);
  assert.equal(after.settledQty, 34);
  assert.equal(after.settledBatches.at(-1).cookieCount, 9);
});

test('settled qty that covers every cookie without recorded batches is still treated as corruption', () => {
  const sales = salesOf(25, 10);
  setCookiePartnerSettledQty(35);
  const summary = cookiePartnerSettlementSummary(sales);
  assert.equal(summary.settledQty, 25);
  assert.equal(summary.unsettledCount, 10);
  assert.equal(getCookiePartnerSettledQty(), 25);
});

test('an intentional catch-up with recorded batches stays settled', async () => {
  const sales = salesOf(25, 6);
  await markCookiePartnerBatchesSent(sales, { partial: true });
  const again = cookiePartnerSettlementSummary(sales);
  assert.equal(again.settledQty, 31);
  assert.equal(again.totalCookies, 31);
  assert.equal(again.unsettledCount, 0);
  assert.equal(again.settledBatches.at(-1).cookieCount, 6);
});

test('owner analytics keeps the partner panel and staff analytics does not', () => {
  assert.match(PAGE_TEMPLATES.analytics, /cookiePartnerPanel/);
  assert.doesNotMatch(STAFF_PAGE_TEMPLATES.analytics, /cookiePartner|cookie-partner|Mark sent|wholesale/);
});
