import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASE_ORIGIN, resolveDeliveryOrigin } from '../../src/domain/geo';
import { fulfillmentFromSnapshot } from '../../src/domain/hours';
import { jointCostAt } from '../../src/domain/joint-cost';
import { cartStockShortfalls, sellAnywayMessage } from '../../src/domain/stock-shortfall';
import { partialSendCount } from '../../src/domain/partner';
import { legacyTarget } from '../../src/domain/legacy-urls';
import {
  INSTALL_STEPS,
  clientNamesText,
  clientOwesLabel,
  debugLogText,
  pushDebug,
  readPaint,
  readStoredId,
  selectionOverStock,
  stockGlance,
  successCopy,
  virtualWindow,
  writePaint,
} from '../../src/domain/parity';
import { sanitizeCookiePartnerSettled } from '../../src/domain/partner';
import {
  buildPosLabelIndex,
  labelsAreStale,
  posCustomerLabel,
  POS_LABEL_STALE_MS,
} from '../../src/domain/pos-labels';
import {
  SCHEDULE_POLL_MS,
  markScheduleFired,
  scheduleAlreadyFired,
  tickLocalSchedules,
} from '../../src/domain/schedule-notify';
import { stockNotifyDecision } from '../../src/domain/stock-notify';

describe('parity row helpers', () => {
  it('blocks a counter line above refreshed stock and still allows opening a short tile', () => {
    expect(selectionOverStock('single_qty', { qty: 3 }, { mint: 2 }, { categoryId: 'mint' })).toBe(true);
    expect(selectionOverStock('single_qty', { qty: 2 }, { mint: 2 }, { categoryId: 'mint' })).toBe(false);
    expect(selectionOverStock('choose_variety', { classic: 1 }, { classic: 0 }, { fixedFlavor: 'classic' })).toBe(
      true,
    );
    expect(selectionOverStock('choose_any', { mint: 2, qty: 9 }, { mint: 1 })).toBe(true);
    expect(selectionOverStock('choose_any', { qty: 4 }, { mint: 0 })).toBe(false);
    expect(selectionOverStock('choose_any', { mint: 0, _unitPrice: 9 }, { mint: 1 })).toBe(false);
    expect(selectionOverStock('choose_variety', { classic: 1 }, { classic: 2 }, { fixedFlavor: 'classic' })).toBe(
      false,
    );
    expect(selectionOverStock('single_qty', { qty: 1 }, {}, {})).toBe(true);
  });

  it('formats an owes hint and a stock glance', () => {
    expect(clientOwesLabel(0)).toBe('');
    expect(clientOwesLabel(-1)).toBe('');
    expect(clientOwesLabel(26000)).toBe('owes UGX 26,000');
    expect(stockGlance(['ok', 'low', 'low', 'out'])).toEqual({ ok: 1, low: 2, out: 1 });
  });

  it('windows at least 48 rows with overscan', () => {
    const rows = Array.from({ length: 80 }, (_, i) => i);
    const mid = virtualWindow(rows, 56 * 20, 56 * 12, 56);
    expect(mid.items.length).toBeGreaterThanOrEqual(12);
    expect(mid.start).toBeGreaterThan(0);
    expect(mid.items[0]).toBe(mid.start);
    expect(virtualWindow(rows, 0, 100, 0).items.length).toBeGreaterThan(0);
    const first = virtualWindow(rows, 0, 672, 56);
    expect(first.items.length).toBeGreaterThanOrEqual(12);
    expect(first.items.length).toBeLessThan(rows.length);
  });

  it('drops a paint cache after 90 seconds and keeps a known period id', () => {
    const raw = writePaint([{ id: 'a' }], 1_000);
    expect(readPaint<Array<{ id: string }>>(raw, 1_000 + 90_000)).toEqual([{ id: 'a' }]);
    expect(readPaint(raw, 1_000 + 90_001)).toBeNull();
    expect(readPaint('nope', 0)).toBeNull();
    expect(readPaint(null, 0)).toBeNull();
    expect(readPaint(JSON.stringify({ data: 1 }), 0)).toBeNull();
    expect(readPaint(JSON.stringify({ ts: 1 }), 5)).toBeNull();
    expect(readStoredId('3m', ['1w', '3m'], '1w')).toBe('3m');
    expect(readStoredId('nope', ['1w'], '1w')).toBe('1w');
    expect(readStoredId(null, ['1w'], '1w')).toBe('1w');
  });

  it('writes the install steps, client names, and a short debug log', () => {
    expect(INSTALL_STEPS.join(' ')).toMatch(/Add to Home Screen/);
    expect(INSTALL_STEPS.join(' ')).toMatch(/Install app/);
    expect(clientNamesText([' Ada ', '', null, 'Bo'])).toBe('Ada\nBo');
    const log = pushDebug(pushDebug([], 'one', 1), 'two', 2);
    expect(debugLogText(log)).toMatch(/one/);
    expect(pushDebug([], '', 3)[0]?.message).toBe('');
    expect(pushDebug(Array.from({ length: 60 }, (_, i) => ({ t: i, message: String(i) })), 'last', 99)).toHaveLength(
      50,
    );
  });

  it('uses the success copy the register shows', () => {
    expect(successCopy({ savingDelivery: true })).toBe('Saving delivery…');
    expect(successCopy({ credit: true })).toBe('Recorded on credit');
    expect(successCopy({})).toBe('Sale recorded');
    expect(successCopy({ queued: true, savingDelivery: true, credit: true })).toMatch(/sync when the signal returns/);
  });

  it('falls back to the shop origin when a store-order cart has no GPS pickup', () => {
    expect(resolveDeliveryOrigin(null)).toEqual({
      lat: BASE_ORIGIN.lat,
      lng: BASE_ORIGIN.lng,
      label: BASE_ORIGIN.label,
    });
    expect(resolveDeliveryOrigin({ lat: 0.3, lng: 32.5, label: 'Gate' }).label).toBe('Gate');
    expect(resolveDeliveryOrigin({ lat: Number.NaN, lng: 1 }).label).toBe(BASE_ORIGIN.label);
    expect(resolveDeliveryOrigin({ lat: 0.2, lng: 32 }).label).toBe('GPS pickup');
  });

  it('sends legacy pages and hashes to the new routes', () => {
    expect(legacyTarget('/pages/inventory.html', '')).toBe('/stock');
    expect(legacyTarget('/next/pages/clients.html', '')).toBe('/clients');
    expect(legacyTarget('/pages/admin.html', '')).toBe('/store');
    expect(legacyTarget('/sell', '#store-orders')).toBe('/orders');
    expect(legacyTarget('/pages/analytics.html', '#stock')).toBe('/insights#stock');
    expect(legacyTarget('/analytics', '#stock')).toBe('/insights#stock');
    expect(legacyTarget('/sell', '#load-store-order=abc')).toBeNull();
    expect(legacyTarget('/pages/inventory.html/', '')).toBe('/stock');
    expect(legacyTarget('/pages/home.html?x=1', '')).toBe('/sell');
    expect(legacyTarget('/sell', '#store-orders&x')).toBe('/orders');
    expect(legacyTarget('/sell', '#store-orders?x')).toBe('/orders');
    expect(legacyTarget('', '')).toBeNull();
  });

  it('dedupes a low crossing for the Kampala day and prefers a POS display name', () => {
    const first = stockNotifyDecision('mint', 5, 4, {}, new Date('2026-06-01T12:00:00Z'));
    expect(first.toast).toBe('low');
    const again = stockNotifyDecision('mint', 5, 4, first.fired, new Date('2026-06-01T18:00:00Z'));
    expect(again.toast).toBe('');
    const nextDay = stockNotifyDecision('mint', 5, 4, first.fired, new Date('2026-06-02T12:00:00Z'));
    expect(nextDay.toast).toBe('low');
    expect(stockNotifyDecision('mint', 1, 0, null, new Date('2026-06-01T12:00:00Z')).toast).toBe('out');
    expect(stockNotifyDecision('mint', 4, 6, {}, new Date('2026-06-01T12:00:00Z')).toast).toBe('');
    const out = stockNotifyDecision('mint', 1, 0, {}, new Date('2026-06-01T12:00:00Z'));
    expect(stockNotifyDecision('mint', 2, 0, out.fired, new Date('2026-06-01T13:00:00Z')).toast).toBe('');

    const index = buildPosLabelIndex([
      { id: 'acc-1', snapchat_name: 'snap', pos_display_name: 'Buyer One' },
      { id: 'acc-2', snapchat_name: 'plain' },
      { snapchat_name: 'skip' },
      null,
    ]);
    expect(buildPosLabelIndex(null).byAccountId.size).toBe(0);
    expect(posCustomerLabel({ account_id: 'acc-1', customer_name: 'snap' }, index)).toBe('Buyer One');
    expect(posCustomerLabel({ customer_name: 'snap' }, index)).toBe('Buyer One');
    expect(posCustomerLabel({ customer_name: 'Store Customer' }, index)).toBe('Store Customer');
    expect(posCustomerLabel({ account_id: 'missing', customer_name: '' }, index)).toBe('Client');
    expect(posCustomerLabel({ pos_display_name: 'Counter' }, index)).toBe('Counter');
    expect(posCustomerLabel(null, index)).toBe('Client');
    expect(labelsAreStale(0, 10)).toBe(true);
    expect(labelsAreStale(1_000, 1_000 + POS_LABEL_STALE_MS - 1)).toBe(false);
    expect(labelsAreStale(1_000, 1_000 + POS_LABEL_STALE_MS)).toBe(true);
  });

  it('ticks a schedule once per day on a 30s poll and resets a corrupted partner total', () => {
    expect(SCHEDULE_POLL_MS).toBe(30_000);
    const now = new Date('2026-06-01T09:00:00Z');
    const due = tickLocalSchedules(
      [{ id: 'open', startMin: 0, endMin: 24 * 60, title: 'Open the shop' }],
      {},
      true,
      now,
    );
    expect(due.titles).toEqual(['Open the shop']);
    expect(scheduleAlreadyFired(due.fired, 'open', now)).toBe(true);
    const second = tickLocalSchedules(
      [{ id: 'open', startMin: 0, endMin: 24 * 60, title: 'Open the shop' }],
      due.fired,
      true,
      now,
    );
    expect(second.titles).toEqual([]);
    expect(tickLocalSchedules([{ id: 'open', startMin: 0, endMin: 10, title: 'x' }], {}, false, now).titles).toEqual(
      [],
    );
    expect(
      tickLocalSchedules([{ id: 'late', startMin: 20 * 60, endMin: 21 * 60, title: 'Late' }], {}, true, now).titles,
    ).toEqual([]);
    expect(scheduleAlreadyFired(null, 'open', now)).toBe(false);
    expect(markScheduleFired(null, 'open', now).open).toBeTruthy();
    expect(sanitizeCookiePartnerSettled(500, 40, 25)).toBe(25);
    expect(sanitizeCookiePartnerSettled(10, 40, 25)).toBe(10);
    expect(sanitizeCookiePartnerSettled(-3, 40, 25)).toBe(25);
    expect(sanitizeCookiePartnerSettled(100, 10, 25)).toBe(100);
    expect(sanitizeCookiePartnerSettled(Number.NaN, 40, 25)).toBe(25);
  });

  it('reads a store-hours snapshot and ignores a corrupt one', () => {
    expect(fulfillmentFromSnapshot(null)).toBeNull();
    expect(fulfillmentFromSnapshot('nope')).toBeNull();
    expect(
      fulfillmentFromSnapshot({
        busy_until: '2026-11-12T12:00:00.000Z',
        busy_for: 'delivery',
        open_time: '08:00',
        close_time: '21:00',
        suggest_start: '09:00',
        suggest_end: '10:00',
        updated_at: '2026-11-12T08:00:00.000Z',
      }),
    ).toMatchObject({ busyFor: 'delivery', openTime: '08:00', closeTime: '21:00' });
    expect(fulfillmentFromSnapshot({ busyFor: 'pickup', openTime: '07:00' })?.busyFor).toBe('pickup');
    expect(fulfillmentFromSnapshot({ busyFor: 'nope' })?.busyFor).toBe('both');
    expect(fulfillmentFromSnapshot({ busyUntil: 'soon', updatedAt: 't' })).toMatchObject({
      busyUntil: 'soon',
      updatedAt: 't',
      openTime: '07:00',
    });
  });

  it('prices a flavored joint at 4,000 only after the effective date', () => {
    const history = [
      { category_id: 'mint', cost_ugx: 5000, effective_from: '1970-01-01T00:00:00.000Z' },
      { category_id: 'mint', cost_ugx: 4000, effective_from: '2026-11-11T15:37:00.000Z' },
      { category_id: 'classic', cost_ugx: 2500, effective_from: '1970-01-01T00:00:00.000Z' },
    ];
    expect(jointCostAt(history, 'mint', '2026-11-11T15:36:00.000Z')).toBe(5000);
    expect(jointCostAt(history, 'mint', '2026-11-11T15:37:00.000Z')).toBe(4000);
    expect(jointCostAt(history, 'classic', '2026-12-01T00:00:00.000Z')).toBe(2500);
    expect(jointCostAt(history, 'mint', 'not-a-date', 7)).toBe(7);
    expect(jointCostAt([{ category_id: 'mint', cost_ugx: 1, effective_from: '2099-01-01T00:00:00.000Z' }], 'mint', '2020-01-01T00:00:00.000Z', 8)).toBe(8);
    expect(jointCostAt(null, 'mint', '2026-12-01T00:00:00.000Z', 9)).toBe(9);
    expect(jointCostAt([{ category_id: 'mint', cost_ugx: -4, effective_from: 'bad' }], 'mint', '2026-12-01T00:00:00.000Z', 3)).toBe(3);
  });

  it('asks to sell anyway when the cart is past system stock', () => {
    expect(cartStockShortfalls(null, null, true)).toEqual([]);
    expect(cartStockShortfalls([{ breakdown: null }, { breakdown: { unknown: 4 } }], { mint: 1 }, true)).toEqual([]);
    expect(cartStockShortfalls([{ breakdown: { mint: 3 } }], { mint: 1 }, false)).toEqual([]);
    expect(cartStockShortfalls([{ breakdown: { mint: 1 } }], { mint: 2 }, true)).toEqual([]);
    const short = cartStockShortfalls([{ breakdown: { mint: 3, spliff7030: 2 } }], { mint: 1, spliff7030: 0 }, true);
    expect(short.map((row) => row.id)).toEqual(['mint', 'spliff7030']);
    expect(short[1]?.name).toMatch(/Bangis/);
    expect(sellAnywayMessage(short)).toMatch(/Sell anyway/);
    expect(partialSendCount(10, 25, 0)).toBe(10);
    expect(partialSendCount(10, 25, 1)).toBe(0);
    expect(partialSendCount(0, 25, 0)).toBe(0);
    expect(partialSendCount(25, 25, 0)).toBe(0);
    expect(partialSendCount(Number.NaN, Number.NaN, 0)).toBe(0);
  });

  it('keeps the manifest id and the two shortcuts', () => {
    const manifest = JSON.parse(readFileSync('legacy/manifest.webmanifest', 'utf8')) as {
      start_url: string;
      scope: string;
      shortcuts: Array<{ url: string }>;
    };
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.shortcuts.map((row) => row.url)).toEqual(['/#store-orders', '/pages/inventory.html']);
  });
});
