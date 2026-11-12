/**
 * Dual-run: store-order-map vs source-mirrored oracles from store-orders.js /
 * orders.js (those modules cannot load in Vitest).
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { PRODUCTS, cookieLineDisplayName } from '../../legacy/js/config.js';
import {
  STORE_COOKIE_TITLES,
  resolveStoreLineName,
  rowsToCartLines,
  mapStoreOrderToCart,
} from '../../src/domain/store-order-map.ts';

const LEGACY_TITLES = {
  'butterscotch-cookie': 'Butterscotch Cookie',
  'strawberry-cookie': 'Strawberry Cookie',
  'mint-cookie': 'Mint Cookie',
  'chocolate-cookie': 'Chocolate Cookie',
  'cookie-duet': 'Cookie Duet',
  'cookie-trio': 'Cookie Trio',
  'cookie-quartet': 'Cookie Quartet',
};

function legacyResolveStoreLineName(line: Record<string, unknown>, product: { id: string; name: string } | undefined) {
  const storeId = String(line.store_product_id || '').toLowerCase();
  if (LEGACY_TITLES[storeId as keyof typeof LEGACY_TITLES]) {
    return LEGACY_TITLES[storeId as keyof typeof LEGACY_TITLES];
  }
  const synced = String(line.product_name || '').trim();
  const productId = String(line.product_id || product?.id || '');
  const breakdown =
    line.breakdown && typeof line.breakdown === 'object'
      ? (line.breakdown as Record<string, unknown>)
      : {};
  if (synced && synced !== 'Cookies') return synced;
  const fromFlavor = cookieLineDisplayName(productId, breakdown, '');
  if (fromFlavor) return fromFlavor;
  return synced || product?.name || 'Item';
}

function legacyRowsToCartLines(
  items: Record<string, unknown>[],
  now: number,
  rand: () => number,
) {
  return items.map((line, index) => {
    const productId = String(line.product_id || '');
    const product = PRODUCTS.find((p: { id: string }) => p.id === productId);
    const isReward = Boolean(line.is_reward) || Boolean(line.reward_key);
    return {
      key: `store-${productId}-${now}-${index}-${rand().toString(36).slice(2, 6)}`,
      productId,
      name: legacyResolveStoreLineName(line, product),
      detail: String(line.detail || ''),
      breakdown:
        line.breakdown && typeof line.breakdown === 'object' ? { ...line.breakdown } : {},
      lineTotal: isReward ? 0 : Math.round(Number(line.line_total) || 0),
      stockDeferred: true,
      isReward,
      rewardKey: isReward ? String(line.reward_key || '') : '',
      pointsCost: isReward ? Math.max(0, Math.round(Number(line.points_cost) || 0)) : 0,
    };
  });
}

describe('store-order-map dual-run', () => {
  it('matches STORE_COOKIE_TITLES', () => {
    expect(STORE_COOKIE_TITLES).toEqual(LEGACY_TITLES);
  });

  it('matches resolveStoreLineName for cookie / generic / unknown', () => {
    const cases = [
      { store_product_id: 'mint-cookie', product_id: 'cookie_single', product_name: 'Cookies' },
      { product_id: 'cookie_single', product_name: 'Cookies', breakdown: { cookie_mint: 1 } },
      { product_id: 'scout', product_name: 'Scout Pack' },
      { product_id: 'nope', product_name: '' },
      { product_id: 'cookie_single', product_name: 'Cookies', breakdown: {} },
    ];
    for (const line of cases) {
      const product = PRODUCTS.find((p: { id: string }) => p.id === line.product_id);
      expect(resolveStoreLineName(line, product)).toBe(legacyResolveStoreLineName(line, product));
    }
  });

  it('matches resolveStoreLineName on 2000 generated lines', () => {
    fc.assert(
      fc.property(
        fc.record({
          store_product_id: fc.constantFrom(
            '',
            'mint-cookie',
            'butterscotch-cookie',
            'strawberry-cookie',
            'chocolate-cookie',
            'cookie-duet',
            'cookie-trio',
            'cookie-quartet',
            'nope',
          ),
          product_id: fc.constantFrom('cookie_single', 'scout', 'pilot', 'cookie_duet', 'nope', ''),
          product_name: fc.constantFrom('Cookies', 'Scout Pack', 'Pilot Pack', '', 'Custom name'),
          breakdown: fc.constantFrom({}, { cookie_mint: 1 }, { mint: 1 }, { cookie_chocolate: 2 }),
        }),
        (line) => {
          const product = PRODUCTS.find((p: { id: string }) => p.id === line.product_id);
          expect(resolveStoreLineName(line, product)).toBe(legacyResolveStoreLineName(line, product));
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('matches rowsToCartLines with injected clock/rand', () => {
    let n = 0;
    const rand = () => {
      n += 1;
      return 0.123456789 * n;
    };
    const items = [
      {
        product_id: 'cookie_duet',
        store_product_id: 'cookie-duet',
        product_name: 'Cookies',
        detail: 'mix',
        breakdown: { cookie_mint: 1, cookie_chocolate: 1 },
        line_total: 15000,
      },
      {
        product_id: 'scout',
        product_name: 'Scout Pack',
        detail: 'Mint',
        breakdown: { mint: 1 },
        line_total: 8000,
        is_reward: true,
        reward_key: 'r1',
        points_cost: 5.6,
      },
    ];
    let n2 = 0;
    const rand2 = () => {
      n2 += 1;
      return 0.123456789 * n2;
    };
    expect(rowsToCartLines(items, { now: 42, rand })).toEqual(
      legacyRowsToCartLines(items, 42, rand2),
    );
  });

  it('mapStoreOrderToCart seeds meta + checkout for delivery', () => {
    const mapped = mapStoreOrderToCart(
      {
        id: 'ord-9',
        phone_e164: '+256700',
        delivery_enabled: true,
        delivery: { mode: 'slot', label: '3:00 PM', deliverAt: '2026-11-12T15:00:00+03:00' },
        delivery_fee_ugx: 4500.4,
        delivery_distance_km: 2.5,
        delivery_duration_min: 14,
        location_label: 'Kololo',
        location_lat: 0.33,
        location_lng: 32.58,
        items: [
          {
            product_id: 'pilot',
            product_name: 'Pilot Pack',
            detail: 'x2',
            breakdown: { mint: 1, strawberry: 1 },
            line_total: 15000,
          },
        ],
      },
      { customerName: 'Amina', now: 1, rand: () => 0.5 },
    );

    expect(mapped.meta).toMatchObject({
      clientName: 'Amina',
      clientPhone: '+256700',
      deliveryEnabled: true,
      deliveryTimeLabel: '3:00 PM',
      deliveryLocationLabel: 'Kololo',
      storeOrderId: 'ord-9',
    });
    expect(mapped.checkout.feeValue).toBe('4500');
    expect(mapped.checkout.predictedFee).toBe(4500);
    expect(mapped.checkout.dest).toEqual({ lat: 0.33, lng: 32.58 });
    expect(mapped.lines[0].stockDeferred).toBe(true);
    expect(mapped.lines[0].lineTotal).toBe(15000);
  });

  it('pickup clears location seed', () => {
    const mapped = mapStoreOrderToCart({
      id: 'p1',
      delivery_enabled: false,
      location_label: 'should-ignore',
      location_lat: 1,
      location_lng: 2,
      delivery_fee_ugx: 9000,
      items: [],
    });
    expect(mapped.meta.deliveryEnabled).toBe(false);
    expect(mapped.meta.deliveryLocationLabel).toBe('');
    expect(mapped.checkout.dest).toBeNull();
    expect(mapped.checkout.feeValue).toBe('');
  });
});
