import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { COOKIE_PARTNER_SETTLE_EVERY } from '../js/config.js';
import { COOKIE_SETTLE_BATCH_MAX, normalizeSettledBatches } from '../js/cookie-partner-batches.js';
import { auditEntry, mergeSettleWrite } from '../netlify/functions/_shared/cookie-settle-merge.mjs';
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
  sendCookiePartnerBatch,
  setCookiePartnerSettledQty,
  syncCookiePartnerSettledQty,
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

/** In-memory settle endpoint that runs the real server merge. */
function fakeServer(state = { qty: 25, batches: [25] }, { failPost = null } = {}) {
  const server = { state: { ...state }, audit: [], gets: 0, posts: [] };
  window.VenusPosAuth = {
    getAccessToken: async () => 'staff-token',
    peekAccessToken: () => 'staff-token',
  };
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /\/api\/cookie-partner\/settle$/);
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body);
      server.posts.push(body);
      if (failPost) {
        if (failPost === 'network') throw new Error('network down');
        return reply(failPost, { error: 'boom' });
      }
      const merged = mergeSettleWrite({
        currentQty: server.state.qty,
        currentBatches: server.state.batches,
        bodyQty: body.settled_qty,
        bodyBatches: body.batches,
      });
      if (!merged.ok) return reply(400, { error: merged.error });
      if (merged.writeBatches) server.state.batches = merged.batches;
      if (merged.applied) {
        server.state.qty = merged.qty;
        server.audit.push(
          auditEntry({ qtyBefore: merged.qtyBefore, qtyAfter: merged.qty, batchSize: merged.batchSize, by: 'u1' }),
        );
      }
      return reply(200, { ok: true, applied: merged.applied, settled_qty: server.state.qty, batches: server.state.batches });
    }
    server.gets += 1;
    return reply(200, { ok: true, settled_qty: server.state.qty, batches: server.state.batches });
  };
  return server;
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
  fakeServer();
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

test('a later sale starts a new batch at the new cookies, and partial history is kept', async () => {
  fakeServer();
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
  fakeServer();
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

test('nothing to send posts nothing', async () => {
  const server = fakeServer();
  const empty = await markCookiePartnerBatchesSent(salesOf(25), { partial: true });
  assert.equal(empty.settledQty, 25);
  assert.equal(empty.unsettledCount, 0);
  assert.equal(server.posts.length, 0);
});

test('a server that stores batch sizes receives the partial count, not a padded 25', async () => {
  const server = fakeServer();
  const after = await markCookiePartnerBatchesSent(salesOf(25, 9), { partial: true });
  assert.equal(server.posts.length, 1);
  assert.equal(server.posts[0].settled_qty, 34);
  assert.deepEqual(server.posts[0].batches, [25, 9]);
  assert.equal(after.settledQty, 34);
  assert.equal(after.settledBatches.at(-1).cookieCount, 9);
});

test('settled qty that covers every cookie without recorded batches is still treated as corruption', () => {
  const sales = salesOf(25, 10);
  setCookiePartnerSettledQty(35);
  const summary = cookiePartnerSettlementSummary(sales);
  assert.equal(summary.settledQty, 25);
  assert.equal(summary.unsettledCount, 10);
  // Rendering is read-only: the stored value is not rewritten by the summary.
  assert.equal(getCookiePartnerSettledQty(), 35);
  assert.equal(mem.get(QTY_KEY), '35');
});

test('rendering the summary never writes localStorage', () => {
  setCookiePartnerSettledQty(35);
  mem.set(BATCH_KEY, JSON.stringify([25, 5]));
  const writes = [];
  const realSet = globalThis.localStorage.setItem;
  const realRemove = globalThis.localStorage.removeItem;
  globalThis.localStorage.setItem = (...a) => (writes.push(a), realSet(...a));
  globalThis.localStorage.removeItem = (...a) => (writes.push(a), realRemove(...a));
  try {
    cookiePartnerSettlementSummary(salesOf(25, 10));
    setCookiePartnerSettledQty; // keep import used
    mem.delete(BATCH_KEY);
    cookiePartnerSettlementSummary(salesOf(25, 10)); // corruption guard path
  } finally {
    globalThis.localStorage.setItem = realSet;
    globalThis.localStorage.removeItem = realRemove;
  }
  assert.deepEqual(writes, []);
});

test('an intentional catch-up with recorded batches stays settled', async () => {
  fakeServer();
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

// ---- Mark sent: server-confirmed, fails visibly, never lowers ----

test('Mark sent success: local state advances only after the server confirms, and the send is audited', async () => {
  const server = fakeServer();
  const result = await sendCookiePartnerBatch(salesOf(25, 12), { partial: true });
  assert.equal(result.ok, true);
  assert.equal(server.state.qty, 37);
  assert.deepEqual(server.state.batches, [25, 12]);
  assert.equal(mem.get(QTY_KEY), '37');
  assert.deepEqual(JSON.parse(mem.get(BATCH_KEY)), [25, 12]);
  assert.equal(server.audit.length, 1);
  assert.deepEqual(
    { b: server.audit[0].qty_before, a: server.audit[0].qty_after, n: server.audit[0].batch_size, by: server.audit[0].by },
    { b: 25, a: 37, n: 12, by: 'u1' },
  );
});

for (const failure of [500, 502, 401, 'network']) {
  test(`Mark sent failure (${failure}): reports it and leaves local state untouched`, async () => {
    const server = fakeServer({ qty: 25, batches: [25] }, { failPost: failure });
    const result = await sendCookiePartnerBatch(salesOf(25, 12), { partial: true });
    assert.equal(result.ok, false);
    assert.equal(result.reason, failure === 'network' ? 'offline' : 'http');
    assert.equal(result.summary.settledQty, 25);
    assert.equal(mem.get(QTY_KEY), '25');
    assert.equal(mem.has(BATCH_KEY), false);
    assert.equal(server.state.qty, 25);
  });
}

test('Mark sent fails visibly when the server cannot be read or the user is signed out', async () => {
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  window.VenusPosAuth = { getAccessToken: async () => 'staff-token', peekAccessToken: () => 'staff-token' };
  const offline = await sendCookiePartnerBatch(salesOf(25, 12), { partial: true });
  assert.equal(offline.ok, false);
  assert.equal(offline.reason, 'offline');
  assert.equal(mem.get(QTY_KEY), '25');

  delete window.VenusPosAuth;
  const out = await sendCookiePartnerBatch(salesOf(25, 12), { partial: true });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'auth');
  assert.equal(mem.get(QTY_KEY), '25');
});

test('an intentional catch-up partial send (qty becomes the total) is allowed', async () => {
  const server = fakeServer();
  const result = await sendCookiePartnerBatch(salesOf(25, 12), { partial: true });
  assert.equal(result.ok, true);
  assert.equal(result.summary.settledQty, result.summary.totalCookies);
  assert.equal(server.state.qty, 37);
});

test('a device behind the server adopts it and does not send over it', async () => {
  const server = fakeServer({ qty: 37, batches: [25, 12] });
  const result = await sendCookiePartnerBatch(salesOf(25, 12, 8), { partial: true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'stale');
  assert.equal(server.posts.length, 0);
  assert.equal(mem.get(QTY_KEY), '37');
  assert.deepEqual(JSON.parse(mem.get(BATCH_KEY)), [25, 12]);
  assert.equal(result.summary.unsettledCount, 8);
});

test('a retry of the identical send after a lost response is idempotent', async () => {
  const server = fakeServer({ qty: 37, batches: [25, 12] });
  // Local is still 25 (response was lost) but the server already holds this exact send.
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (init?.method === 'POST') return real(url, init);
    return { ok: true, status: 200, json: async () => ({ ok: true, settled_qty: 25, batches: [25] }) };
  };
  const result = await sendCookiePartnerBatch(salesOf(25, 12), { partial: true });
  assert.equal(result.ok, true);
  assert.equal(server.state.qty, 37);
  assert.equal(server.audit.length, 0);
});

test('sync: a stale device with local 250 adopts the remote 262 and never pushes 250 back', async () => {
  const cuts = [25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 12];
  const server = fakeServer({ qty: 262, batches: cuts });
  setCookiePartnerSettledQty(250);
  const merged = await syncCookiePartnerSettledQty(285);
  assert.equal(merged, 262);
  assert.equal(mem.get(QTY_KEY), '262');
  assert.deepEqual(JSON.parse(mem.get(BATCH_KEY)), cuts);
  assert.equal(server.posts.length, 0);
  assert.equal(server.state.qty, 262);
});

// ---- Server merge (the real module) ----

const CUTS_262 = [25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 12];

test('server merge: a lower or equal qty never changes the stored state', () => {
  for (const bodyQty of [250, 25, 0, 262]) {
    const m = mergeSettleWrite({ currentQty: 262, currentBatches: CUTS_262, bodyQty, bodyBatches: null });
    assert.equal(m.applied, false);
    assert.equal(m.qty, 262);
    assert.deepEqual(m.batches, CUTS_262);
    assert.equal(m.writeBatches, false);
  }
  const lowerWithBatches = mergeSettleWrite({
    currentQty: 262,
    currentBatches: CUTS_262,
    bodyQty: 250,
    bodyBatches: Array(10).fill(25),
  });
  assert.equal(lowerWithBatches.qty, 262);
  assert.deepEqual(lowerWithBatches.batches, CUTS_262);
});

test('server merge: a higher qty is applied and extends, never rewrites, the stored cuts', () => {
  const ok = mergeSettleWrite({
    currentQty: 262,
    currentBatches: CUTS_262,
    bodyQty: 285,
    bodyBatches: [...CUTS_262, 23],
  });
  assert.equal(ok.applied, true);
  assert.equal(ok.qty, 285);
  assert.equal(ok.batchSize, 23);
  assert.deepEqual(ok.batches, [...CUTS_262, 23]);

  // Client cuts that contradict stored history are replaced by stored cuts + the new chunk.
  const rewrite = mergeSettleWrite({
    currentQty: 262,
    currentBatches: CUTS_262,
    bodyQty: 285,
    bodyBatches: [25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 10],
  });
  assert.deepEqual(rewrite.batches, [...CUTS_262, 23]);

  // No batches in the body: stored cuts are kept and the new chunk is appended.
  const noBatches = mergeSettleWrite({ currentQty: 262, currentBatches: CUTS_262, bodyQty: 285, bodyBatches: null });
  assert.deepEqual(noBatches.batches, [...CUTS_262, 23]);

  // Invalid batches are refused.
  const bad = mergeSettleWrite({ currentQty: 262, currentBatches: CUTS_262, bodyQty: 285, bodyBatches: [999] });
  assert.equal(bad.ok, false);
});

test('server merge: audit entry shape', () => {
  const e = auditEntry({ at: '2026-11-12T00:00:00.000Z', qtyBefore: 262, qtyAfter: 285, batchSize: 23, by: 'u1' });
  assert.deepEqual(e, { at: '2026-11-12T00:00:00.000Z', qty_before: 262, qty_after: 285, batch_size: 23, by: 'u1' });
});
