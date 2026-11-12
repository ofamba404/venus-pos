/**
 * Dual-run: sale payload vs inlined legacy oracles from orders.js
 * (orders.js cannot load in Vitest — closes over `location`).
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  buildSaleItems,
  buildSaleFulfillmentFields,
  buildSalePostBody,
} from '../../src/domain/sale-payload.ts';
import type { CartLine, OrderMeta } from '../../src/domain/cart.ts';

/** Oracle: orders.js:2454-2470 */
function legacyBuildSaleItems(cart: CartLine[]) {
  return cart.map((i) => ({
    product_id: i.productId,
    product_name: i.name,
    detail: i.detail,
    line_total: Boolean(i.isReward) ? 0 : i.lineTotal,
    breakdown: i.breakdown,
    ...(Boolean(i.isReward)
      ? {
          is_reward: true,
          reward_key: String(i.rewardKey || ''),
          points_cost: Math.max(0, Math.round(Number(i.pointsCost) || 0)),
        }
      : {}),
    ...(i.wholesaleUnitPrice
      ? { wholesale_unit_price: Math.round(Number(i.wholesaleUnitPrice) || 0) }
      : {}),
  }));
}

/** Oracle: orders.js:299-334 with injected checkout state */
function legacyFulfillment(
  meta: Partial<OrderMeta>,
  checkout: {
    destText?: string;
    dest?: { lat?: number; lng?: number } | null;
    feeValue?: string;
    distanceKm?: number | null;
    durationMin?: number | null;
  },
) {
  const phone = String(meta.clientPhone || '').trim();
  const locationLabel = String(meta.deliveryLocationLabel || checkout.destText || '').trim();
  const deliveryLabel = String(meta.deliveryTimeLabel || '').trim();
  const deliveryMode = String(meta.deliveryTimeMode || '').trim();
  const deliverAt = String(meta.deliveryDeliverAt || '').trim();
  const linkedStoreOrderId = String(meta.storeOrderId || '').trim();
  const feeParsed = parseInt(String(checkout.feeValue ?? ''), 10);
  const lat = checkout.dest?.lat != null ? Number(checkout.dest.lat) : NaN;
  const lng = checkout.dest?.lng != null ? Number(checkout.dest.lng) : NaN;
  const delivery: Record<string, string> = {};
  if (deliveryMode) delivery.mode = deliveryMode;
  if (deliveryLabel) delivery.label = deliveryLabel;
  if (deliverAt) delivery.deliverAt = deliverAt;
  return {
    client_phone: phone || null,
    delivery_enabled: meta.deliveryEnabled !== false,
    delivery,
    location_label: locationLabel || null,
    location_lat: Number.isFinite(lat) ? lat : null,
    location_lng: Number.isFinite(lng) ? lng : null,
    delivery_fee_ugx: Number.isFinite(feeParsed) && feeParsed >= 0 ? feeParsed : null,
    delivery_distance_km:
      checkout.distanceKm == null || Number.isNaN(Number(checkout.distanceKm))
        ? null
        : Number(checkout.distanceKm),
    delivery_duration_min:
      checkout.durationMin == null || Number.isNaN(Number(checkout.durationMin))
        ? null
        : Number(checkout.durationMin),
    store_order_id: linkedStoreOrderId || null,
  };
}

describe('sale-payload dual-run', () => {
  it('matches items for paid, reward, and wholesale lines', () => {
    const cart: CartLine[] = [
      {
        key: '1',
        productId: 'scout',
        name: 'Scout Pack',
        detail: 'Mint x1',
        breakdown: { mint: 1 },
        lineTotal: 8000,
      },
      {
        key: '2',
        productId: 'cookie_single',
        name: 'Mint Cookie',
        detail: 'Mint x1',
        breakdown: { cookie_mint: 1 },
        lineTotal: 8000,
        isReward: true,
        rewardKey: 'r1',
        pointsCost: 10.4,
      },
      {
        key: '3',
        productId: 'cookie_wholesale',
        name: 'Wholesale cookies',
        detail: 'mix',
        breakdown: { cookie_mint: 8 },
        lineTotal: 24000,
        wholesaleUnitPrice: 3000.6,
      },
    ];
    expect(buildSaleItems(cart)).toEqual(legacyBuildSaleItems(cart));
  });

  it('matches fulfillment for pickup / delivery / store order', () => {
    const cases: Array<{
      meta: Partial<OrderMeta>;
      checkout: Parameters<typeof legacyFulfillment>[1];
    }> = [
      { meta: { deliveryEnabled: false }, checkout: {} },
      {
        meta: {
          clientPhone: ' 0700 ',
          deliveryEnabled: true,
          deliveryTimeMode: 'asap',
          deliveryTimeLabel: 'ASAP',
          deliveryDeliverAt: '2026-11-12T12:00:00+03:00',
          deliveryLocationLabel: 'Ntinda',
          storeOrderId: 'ord-1',
        },
        checkout: {
          dest: { lat: 0.34, lng: 32.58 },
          feeValue: '5000',
          distanceKm: 3.2,
          durationMin: 18,
        },
      },
      {
        meta: { deliveryEnabled: true },
        checkout: { feeValue: 'nope', distanceKm: NaN, dest: { lat: null as never, lng: 1 } },
      },
    ];
    for (const c of cases) {
      expect(buildSaleFulfillmentFields(c.meta, c.checkout)).toEqual(
        legacyFulfillment(c.meta, c.checkout),
      );
    }
  });

  it('buildSalePostBody credit vs paid', () => {
    const lines: CartLine[] = [
      {
        key: '1',
        productId: 'scout',
        name: 'Scout Pack',
        detail: '',
        breakdown: { mint: 1 },
        lineTotal: 8000,
      },
    ];
    const paid = buildSalePostBody({
      lines,
      meta: { clientPhone: '1' },
      clientId: 'c1',
      isCredit: false,
    });
    expect(paid.amount_paid_ugx).toBe(8000);
    expect(paid.credit_cleared).toBe(true);
    expect(paid.is_credit).toBe(false);

    const credit = buildSalePostBody({
      lines,
      meta: {},
      clientId: 'c1',
      isCredit: true,
    });
    expect(credit.amount_paid_ugx).toBe(0);
    expect(credit.credit_cleared).toBe(false);
  });

  it('fulfillment matches oracle for random phones/fees (2000 runs)', () => {
    fc.assert(
      fc.property(
        fc.record({
          clientPhone: fc.string(),
          deliveryEnabled: fc.option(fc.boolean(), { nil: undefined }),
          deliveryTimeMode: fc.string(),
          deliveryTimeLabel: fc.string(),
          deliveryDeliverAt: fc.string(),
          deliveryLocationLabel: fc.string(),
          storeOrderId: fc.string(),
        }),
        fc.record({
          destText: fc.string(),
          feeValue: fc.string(),
          distanceKm: fc.option(fc.double({ noNaN: false }), { nil: null }),
          durationMin: fc.option(fc.integer({ min: -5, max: 200 }), { nil: null }),
          dest: fc.option(
            fc.record({
              lat: fc.double({ noNaN: true }),
              lng: fc.double({ noNaN: true }),
            }),
            { nil: null },
          ),
        }),
        (meta, checkout) => {
          expect(buildSaleFulfillmentFields(meta, checkout)).toEqual(
            legacyFulfillment(meta, checkout),
          );
        },
      ),
      { numRuns: 2000 },
    );
  });
});
