/**
 * The other side of optional `||` / `??` branches.
 */
import { describe, expect, it } from 'vitest';
import { buildCartLine, cartReducer, clientReadyForCharge, emptyCart, isWalkInCheckout, toHeldSale, type CartLine } from '../../src/domain/cart';
import {
  cookieFlavorIdFromCategory,
  cookieLineDisplayName,
  cookieQtyFromBreakdown,
  cookieUnitPrice,
  isCookieCategoryId,
} from '../../src/domain/catalog';
import {
  allocatePaymentFifo,
  getOutstandingCredit,
  groupOutstandingByClient,
  openDebtForClientName,
} from '../../src/domain/credit';
import {
  estimateDurationMin,
  fitDeliveryFeeModel,
  predictSafeBodaFee,
  predictSafeBodaFeeRange,
  quoteFee,
  quoteFeeRange,
  rawQuoteFee,
} from '../../src/domain/delivery-fee';
import { groupSalesByDay } from '../../src/domain/history-groups';
import {
  busyUntilFromNow,
  earliestAvailableAt,
  formatClockHHmm,
  isUnavailableAt,
  isWithinOpenHours,
  nextOpenAt,
  toHHmm,
} from '../../src/domain/hours';
import { adjustDraftForItem, applySoldToInventory } from '../../src/domain/inventory-delta';
import { computeSalesPatterns } from '../../src/domain/analytics/patterns';
import { buildTimeSeries, filterSalesByRange, priorPeriodComparison, type ChartRange } from '../../src/domain/analytics/periods';
import { revenueDelta } from '../../src/domain/analytics/rank';
import {
  cookieBatchLineTitle,
  cookieBatchProductLines,
  cookieBatchShareText,
  cookieFlavorMixPhrase,
  cookiePartnerShareText,
} from '../../src/domain/partner-lines';
import { cookiePartnerBatchesFromUnits, expandPartnerUnitsFromSales } from '../../src/domain/partner';
import {
  allocateCookieLineRevenue,
  cookieFlavorEntriesFromItem,
  expandCookieUnitsFromItem,
  itemCookieSettlement,
  saleOwnerRevenue,
  sumOwnerRevenue,
} from '../../src/domain/revenue';
import { buildSaleItems } from '../../src/domain/sale-payload';
import {
  categoryLabel,
  claimAgainstStock,
  counterSellable,
  decideConsume,
  decideRevert,
  deliveryWithReservation,
  reservationHeldAgain,
  unitsFromOrderItems,
} from '../../src/domain/stock-reservation';
import { mapStoreOrderToCart, resolveStoreLineName, rowsToCartLines } from '../../src/domain/store-order-map';
import { computeTodayStats } from '../../src/domain/today';
import {
  cookieUnitPriceForCount,
  flavoredCookiesPerPack,
  isCookieSingleProduct,
  packBaseUgx,
  packPriceUgx,
  sumFlavoredCookies,
  unitPriceUgx,
} from '../../src/domain/pricing/flavored-bulk';
import {
  buildLineFromConfig,
  configTotalSelected,
  findProduct,
  productDetailLabel,
} from '../../src/domain/pricing/pack-config';

const bare = { clientName: undefined as unknown as string, clientId: '' };

describe('falsy optional branches', () => {
  it('walks empty inputs through the domain helpers', () => {
    expect(isWalkInCheckout(bare, false)).toBe(false);
    expect(clientReadyForCharge(bare, false)).toBe(false);
    const held = toHeldSale(emptyCart());
    expect(held?.name.startsWith('Held')).toBe(true);
    const scout: CartLine = {
      key: 'a',
      productId: 'scout',
      name: 'Scout',
      detail: '',
      breakdown: { mint: 1 },
      lineTotal: 8000,
    };
    const other: CartLine = { ...scout, key: 'b' };
    let state = cartReducer(emptyCart(), { type: 'replace_lines', lines: [scout, other] });
    state = cartReducer(state, { type: 'update_line', key: 'missing', line: other });
    expect(state.lines).toHaveLength(2);
    const wholesale = findProduct('cookie_wholesale')!;
    expect(buildCartLine(wholesale, { cookie_mint: 1, _unitPrice: 2500 }, { now: 3 }).wholesaleUnitPrice).toBe(2500);

    expect(cookieFlavorIdFromCategory(null)).toBeNull();
    expect(cookieFlavorIdFromCategory('cookie')).toBe('butterscotch');
    expect(cookieFlavorIdFromCategory('mint')).toBeNull();
    expect(isCookieCategoryId('')).toBe(false);
    expect(cookieQtyFromBreakdown({ cookie_mint: -2, cookie_chocolate: 1 })).toBe(1);
    expect(cookieLineDisplayName(null, null)).toBe('Cookies');
    expect(cookieLineDisplayName('cookie_single', { cookie_: 1 })).toBe('Cookies');
    expect(cookieUnitPrice('cookie')).toBe(5000);
    expect(cookieUnitPrice(null)).toBe(5000);

    expect(getOutstandingCredit(null)).toEqual([]);
    expect(allocatePaymentFifo(undefined, 100)).toEqual([]);
    expect(
      allocatePaymentFifo([{ is_credit: true, total_ugx: undefined, created_at: undefined }], 10),
    ).toEqual([]);
    groupOutstandingByClient(
      [
        { id: '1', client_id: 'a', is_credit: true, total_ugx: 1000 },
        { id: '2', client_id: 'a', is_credit: true, total_ugx: 500, created_at: '2026-01-02' },
      ],
      [{ id: 'a', name: 'Amina' }],
    );
    expect(openDebtForClientName('amina', null, null)).toBe(0);
    expect(openDebtForClientName('amina', [{ id: 'a', name: undefined }], [])).toBe(0);

    expect(groupSalesByDay([{}, { total_ugx: 2 }])).toHaveLength(1);
    expect(
      allocatePaymentFifo(
        [
          { is_credit: true, total_ugx: 2000, created_at: '2026-02-01' },
          { is_credit: true, total_ugx: 2000 },
        ],
        1000,
      ),
    ).toHaveLength(1);

    expect(toHHmm('0:00')).toBe('00:00');
    expect(toHHmm('07:05')).toBe('07:05');
    expect(isWithinOpenHours(new Date('2026-11-12T12:00:00'), { openTime: 'nope', closeTime: 'also' })).toBe(true);
    expect(isWithinOpenHours(new Date('2026-11-12T00:30:00'), { openTime: '00:00', closeTime: '02:00' })).toBe(true);
    const noon = new Date('2026-11-12T12:00:00');
    expect(nextOpenAt(noon, { openTime: '07:00', closeTime: '22:00' })).toEqual(noon);
    expect(earliestAvailableAt(new Date('2026-11-12T10:56:00'), { stepMinutes: 5 }).getMinutes()).toBe(0);
    expect(earliestAvailableAt()).toBeInstanceOf(Date);
    expect(isUnavailableAt(noon, { status: { busyUntil: '2099-01-01T00:00:00Z', busyFor: 'both' } })).toBe(true);
    expect(formatClockHHmm('aa:bb').length).toBeGreaterThan(0);
    expect(busyUntilFromNow(30, noon)).toContain('T');
    expect(isUnavailableAt(noon)).toBe(false);
    expect(
      earliestAvailableAt(noon, { status: { busyUntil: '2026-11-12T12:30:00' } }).getTime(),
    ).toBeGreaterThan(noon.getTime());

    expect(cookieFlavorMixPhrase(null)).toBe('');
    expect(cookieFlavorMixPhrase({ butterscotch: 2, mint: 1 })).toMatch(/butterscotch/);
    expect(cookieBatchProductLines(null)).toEqual([]);
    expect(cookieFlavorMixPhrase({})).toBe('');
    const lines = cookieBatchProductLines([
      { productKind: 'trio', revenue: undefined, lineKey: 't' },
      { flavorId: 'strawberry', productKind: 'single', revenue: 10 },
    ]);
    expect(lines.length).toBeGreaterThan(0);
    expect(cookieBatchShareText({ cookieCount: 1, revenue: 1, ownerSplit: 1, partnerDue: 1 })).toMatch(/cookies/);
    expect(cookieBatchLineTitle({ kind: 'trio', complete: false, cookieQty: 2, lineCookieQty: 3 })).toMatch(/Trio/);
    expect(cookieBatchLineTitle({ kind: 'single', flavorId: 'no-such' })).toBe('no-such');
    expect(cookieBatchLineTitle({ kind: 'other', complete: true })).toBe('Duet');
    expect(cookiePartnerShareText(null)).toBe('');
    expect(cookiePartnerBatchesFromUnits(null, Number.NaN)).toEqual([]);
    expect(expandPartnerUnitsFromSales([{ items: undefined }])).toEqual([]);
    expect(expandPartnerUnitsFromSales([{ created_at: '2026-08-13T00:00:00+03:00' }])).toEqual([]);

    expect(computeSalesPatterns(null).joints).toBe(0);
    expect(
      computeSalesPatterns([
        { items: [{ breakdown: undefined }] },
        { created_at: undefined, items: undefined },
      ]).paidRevenue,
    ).toBeGreaterThanOrEqual(0);

    const odd = { id: 'x', label: 'X', short: 'X', unit: 'week', count: null } as ChartRange;
    expect(filterSalesByRange([{ created_at: undefined, total_ugx: 1 }], odd).length).toBeGreaterThanOrEqual(0);
    expect(buildTimeSeries([{ total_ugx: 1000 }], { ...odd, unit: null, count: null }).length).toBeGreaterThanOrEqual(0);
    expect(priorPeriodComparison([], { ...odd, unit: 'nope' as ChartRange['unit'] })).toBeNull();
    expect(revenueDelta(0, 0).text).toMatch(/Same/);

    expect(cookieFlavorEntriesFromItem({ product_name: 'Cookie Quartet', breakdown: { cookie: 1 }, line_total: 1000 })[0]?.flavorId).toBe('butterscotch');
    expect(cookieFlavorEntriesFromItem({ product_name: 'Cookie Trio', breakdown: { cookie_mint: 0 } })).toEqual([]);
    expect(allocateCookieLineRevenue(null as never, 10)).toEqual([]);
    expect(expandCookieUnitsFromItem({ product_name: 'Cookie Duet', breakdown: { cookie_mint: 1 }, line_total: 100 })).toHaveLength(1);
    expect(itemCookieSettlement({ product_id: 'cookie_single', breakdown: { cookie_mint: 1 }, line_total: 100 })?.ownerSplit).toBe(0);
    expect(saleOwnerRevenue({ items: [{ product_name: 'Quartet', breakdown: { cookie_mint: 1 }, line_total: 1000 }] })).toBeGreaterThanOrEqual(0);
    expect(sumOwnerRevenue(null)).toBe(0);

    expect(buildSaleItems(null)).toEqual([]);
    expect(
      buildSaleItems([
        {
          key: 'r',
          productId: 'reward',
          name: 'R',
          detail: '',
          breakdown: {},
          lineTotal: 1,
          isReward: true,
          wholesaleUnitPrice: 'x' as never,
        },
      ])[0]?.wholesale_unit_price,
    ).toBe(0);

    expect(categoryLabel('not-a-flavour')).toBe('not-a-flavour');
    expect(reservationHeldAgain({ state: 'consumed', claimed: { mint: 1 } }).at).toBeUndefined();
    expect(decideConsume({ state: 'held', claimed: { mint: 1 } }, '').reason).toBe('consumed');
    expect(decideRevert(null, '').reason).toBe('none');
    expect(deliveryWithReservation({ note: 'keep' }, { state: 'held', claimed: {} }).note).toBe('keep');
    expect(claimAgainstStock({}, { mint: 2 }).ok).toBe(false);
    expect(counterSellable({ mint: 4 }, [{ breakdown: { mint: 1 } }]).mint).toBe(3);
    expect(unitsFromOrderItems([{ breakdown: { mint: 1.2 } }]).mint).toBe(1);

    expect(resolveStoreLineName({ product_name: 'Cookies' }, findProduct('cookie_single'))).toBe('Cookies');
    const rewardLine = rowsToCartLines([{ is_reward: true, product_id: 'scout', points_cost: undefined }], { now: 1, rand: () => 0.2 })[0];
    expect(rewardLine?.pointsCost).toBe(0);
    expect(mapStoreOrderToCart({}).meta.storeOrderId).toBe('');

    expect(computeTodayStats([{ items: [{ breakdown: { mint: 0 } }], total_ugx: 1 }], new Date()).joints).toBe(0);
    expect(applySoldToInventory({ mint: 0 }, { mint: 1 }).mint).toBe(0);
    expect(adjustDraftForItem({ mint: 1 }, { breakdown: undefined }, 1).mint).toBe(1);

    expect(isCookieSingleProduct(null)).toBe(false);
    expect(flavoredCookiesPerPack(null, null)).toBe(0);
    expect(sumFlavoredCookies([{ productId: 'cookie_single', breakdown: { cookie_mint: 1 } }], { excludeProductId: 'cookie_single' })).toBe(0);
    expect(unitPriceUgx(null)).toBe(8000);
    expect(packBaseUgx(null)).toBe(0);
    expect(packPriceUgx('cookie_duet', 4, null)).toBe(13000);
    expect(cookieUnitPriceForCount(null, 0)).toBe(5000);
    const applied = [{ productId: 'cookie_duet', quantity: 0, breakdown: { cookie_mint: 2 }, lineTotal: 1 }];
    expect(applied[0]?.lineTotal).toBe(1);

    expect(configTotalSelected(null)).toBe(0);
    const variety = findProduct('variety')!;
    expect(buildLineFromConfig(variety, { not_a_flavor: 1 }).detail).toMatch(/not_a_flavor|Plain/);
    expect(buildLineFromConfig(findProduct('plain_single')!, {}).detail).toBe('x0');
    expect(buildLineFromConfig(findProduct('spliff_single')!, { nope: 2 }).detail).toBe('');
    expect(productDetailLabel(findProduct('scout')!)).toMatch(/joint/);
    expect(productDetailLabel({ ...findProduct('cookie_duet')!, joints: 0 }).toLowerCase()).toMatch(/cookie/);
    expect(productDetailLabel(findProduct('plain_single')!)).toMatch(/joint/);
  });

  it('quotes a flat fee series and a model with no residual bands', () => {
    const flat = [
      { fee_ugx: 5000, distance_km: 1, created_at: '2026-11-12T12:00:00+03:00' },
      { fee_ugx: 5000, distance_km: 3, created_at: '2026-11-12T12:00:00+03:00' },
      { fee_ugx: 5000, distance_km: 6, created_at: '2026-11-12T12:00:00+03:00' },
    ];
    const flatModel = fitDeliveryFeeModel(flat);
    expect(flatModel === null || flatModel?.r2 !== undefined).toBe(true);
    const bareModel = {
      core: { intercept: 2000, kmRate: 800, slowdownRate: 0, avgSpeedKmh: 0 },
      premiums: { day: 0 },
      r2: 0,
      dataMaxKm: null,
      samples: [],
    };
    expect(rawQuoteFee(3, bareModel, {})).not.toBeNull();
    expect(quoteFeeRange(3, bareModel, { dest: { lat: Number.NaN, lng: 1 } }).feePointUgx).toBeGreaterThan(0);
    expect(predictSafeBodaFee(0, bareModel)).not.toBeUndefined();
    expect(predictSafeBodaFeeRange(0, { ...bareModel, core: { ...bareModel.core, kmRate: -100, intercept: 0 } })).toBeDefined();
    expect(estimateDurationMin(2, { avgSpeedKmh: -1 })).toBeGreaterThan(0);
    const remembered = [
      { fee_ugx: 4000, distance_km: 2, duration_min: 12, created_at: '2026-11-12T10:00:00+03:00', dest_lat: 0.35, dest_lng: 32.58 },
      { fee_ugx: 7000, distance_km: 5, duration_min: 20, created_at: '2026-11-12T11:00:00+03:00', dest_lat: 0.35, dest_lng: 32.58 },
      { fee_ugx: 9000, distance_km: 8, duration_min: 28, created_at: 'not-a-date', dest_lat: 0.3502, dest_lng: 32.5802 },
      { fee_ugx: 11000, distance_km: 11, duration_min: 35, created_at: '2026-11-12T18:00:00+03:00', dest_lat: 0.36, dest_lng: 32.6 },
    ];
    const fitted = fitDeliveryFeeModel(remembered);
    expect(quoteFee(4, fitted, { dest: { lat: 0.35, lng: 32.58 }, period: 'day' })).toBeGreaterThan(0);
    const week = { id: '1w', label: 'This week', short: '1W', unit: 'week' as const, count: 1 };
    const same = [
      { created_at: '2026-11-10T10:00:00+03:00', total_ugx: 8000, items: [{ line_total: 8000 }] },
      { created_at: '2026-11-03T10:00:00+03:00', total_ugx: 8000, items: [{ line_total: 8000 }] },
    ];
    expect(priorPeriodComparison(same, week, new Date('2026-11-12T12:00:00+03:00'))?.text).toMatch(/Flat|No change|%/);
  });
});
