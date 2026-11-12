/**
 * Branch coverage for domain helpers the dual-run properties do not reach.
 */
import { describe, expect, it } from 'vitest';
import {
  cartReducer,
  cartTotal,
  clientReadyForCharge,
  cloneLines,
  emptyCart,
  isWalkInCheckout,
  toHeldSale,
  type CartLine,
} from '../../src/domain/cart';
import {
  allocatePaymentFifo,
  creditBalance,
  getClientOutstandingCredit,
  groupOutstandingByClient,
  isOutstandingCredit,
  openDebtForClientName,
  sumCreditOwed,
} from '../../src/domain/credit';
import {
  canonicalInventoryCategoryId,
  cookieCategoryId,
  cookieLineDisplayName,
  cookieUnitPrice,
  cookieWholesaleUgx,
  normalizeInventoryBreakdown,
} from '../../src/domain/catalog';
import { formatCompact, formatUGX } from '../../src/domain/format';
import { roadKmEstimate } from '../../src/domain/geo';
import { groupSalesByDay, partitionThisWeek } from '../../src/domain/history-groups';
import {
  busyUntilFromNow,
  earliestAvailableAt,
  formatClockHHmm,
  hasBusyUntil,
  isBusyActive,
  isUnavailableAt,
  isWithinOpenHours,
  nextOpenAt,
} from '../../src/domain/hours';
import {
  adjustDraftForItem,
  applySoldToInventory,
  cartSoldDeltas,
  mergeSoldBreakdown,
  soldDeltas,
} from '../../src/domain/inventory-delta';
import { contrastInk, relativeLuminance } from '../../src/domain/luminance';
import {
  applyToCartLines,
  cookieUnitPriceForCount,
  flavoredCookiesPerPack,
  getProgress,
  isCookiePackProduct,
  isCookiePricedProduct,
  isCookieSingleProduct,
  lineTotalForCookieProduct,
  packPriceUgx,
  singleLineTotalUgx,
  sumFlavoredCookies,
} from '../../src/domain/pricing/flavored-bulk';
import {
  breakdownToConfigSelection,
  buildLineFromConfig,
  configTotalSelected,
  findProduct,
  itemToConfigSelection,
  wholesaleUnitPriceFromItem,
} from '../../src/domain/pricing/pack-config';
import {
  allocateCookieLineRevenue,
  cookieFlavorEntriesFromItem,
  expandCookieUnitsFromItem,
  itemCookieSettlement,
  itemOwnerRevenue,
  saleOwnerRevenue,
  salePaidRatio,
  saleRecognizedOwnerRevenue,
} from '../../src/domain/revenue';
import { buildSaleFulfillmentFields, buildSaleItems, buildSalePostBody } from '../../src/domain/sale-payload';
import { canonicalProductName, revenueDelta, topProductForSales } from '../../src/domain/analytics/rank';
import {
  availableFromPools,
  claimAgainstStock,
  counterSellable,
  decideClaim,
  decideConsume,
  decideRevert,
  decideUnclaim,
  deliveryWithReservation,
  releaseAgainstStock,
  reservationOf,
  shortageMessage,
  soldExcludingHold,
  unitsFromOrderItems,
} from '../../src/domain/stock-reservation';
import { stockCrossing, stockLevel } from '../../src/domain/stock-state';
import { mapStoreOrderToCart, resolveStoreLineName, rowsToCartLines } from '../../src/domain/store-order-map';
import { computeTodayStats, salesToday } from '../../src/domain/today';
import { cookiePartnerBatchesFromUnits, expandPartnerUnitsFromSales, openPartnerBatches } from '../../src/domain/partner';
import { buildDefaultSeed } from '../fixtures/seed';

const line = (partial: Partial<CartLine> & Pick<CartLine, 'key' | 'productId'>): CartLine => ({
  name: partial.productId,
  detail: '',
  breakdown: {},
  lineTotal: 0,
  ...partial,
});

describe('domain branches', () => {
  it('covers credit grouping, fifo clamps, and name debt', () => {
    expect(isOutstandingCredit(null)).toBe(false);
    expect(creditBalance({ is_credit: true, credit_cleared: false, total_ugx: 1000, amount_paid_ugx: 5000 })).toBe(0);
    expect(getClientOutstandingCredit(null, '')).toEqual([]);
    expect(getClientOutstandingCredit([{ is_credit: true, client_id: 'a', total_ugx: 1000 }], 'a')).toHaveLength(1);
    expect(sumCreditOwed(null)).toBe(0);
    expect(allocatePaymentFifo(null, 0)).toEqual([]);
    expect(
      allocatePaymentFifo(
        [
          { id: 'new', created_at: '2026-02-01', is_credit: true, total_ugx: 1000, amount_paid_ugx: 0 },
          { id: 'old', created_at: '2026-01-01', is_credit: true, total_ugx: 4000, amount_paid_ugx: 1000 },
          { id: 'cleared', created_at: '2025-01-01', is_credit: true, credit_cleared: true, total_ugx: 9000 },
        ],
        5000,
      ).map((row) => row.sale.id),
    ).toEqual(['old', 'new']);

    const sales = [
      { id: '1', client_id: 'a', is_credit: true, total_ugx: 2000, created_at: '2026-02-01' },
      { id: '2', client_id: 'b', is_credit: true, total_ugx: 2000, created_at: '2026-01-01' },
      { id: '3', client_id: '', is_credit: true, total_ugx: 500, created_at: '2026-03-01' },
      { id: '4', is_credit: true, total_ugx: 500, created_at: '2026-03-02' },
    ];
    const groups = groupOutstandingByClient(sales, [
      { id: 'a', name: 'Amina' },
      { id: 'b', name: 'amina' },
    ]);
    expect(groups[0]?.name.toLowerCase()).toBe('amina');
    expect(groups[0]?.sales).toHaveLength(2);
    expect(openDebtForClientName('  Amina ', [{ id: 'a', name: 'Amina' }, { id: 'b', name: 'amina' }], sales)).toBe(4000);
    expect(openDebtForClientName('', [], [])).toBe(0);
    expect(openDebtForClientName('Missing', [{ id: 'a', name: 'Amina' }], sales)).toBe(0);
  });

  it('covers hours overnight, busy modes, and invalid clocks', () => {
    const overnight = { openTime: '22:00', closeTime: '06:00', busyFor: 'both' as const };
    const late = new Date('2026-11-12T23:00:00');
    const noon = new Date('2026-11-12T12:00:00');
    expect(isWithinOpenHours(late, overnight)).toBe(true);
    expect(isWithinOpenHours(noon, overnight)).toBe(false);
    expect(isWithinOpenHours('nope', { openTime: 'same', closeTime: 'same' })).toBe(true);
    expect(isWithinOpenHours(noon, { openTime: '07:00', closeTime: '07:00' })).toBe(true);
    expect(nextOpenAt(new Date(Number.NaN), overnight).getTime()).toBeGreaterThan(0);
    expect(hasBusyUntil({ busyUntil: '2026-11-12T15:00:00Z' })).toBe(true);
    expect(hasBusyUntil({})).toBe(false);
    expect(isBusyActive({ busyUntil: 'not-a-date' }, noon)).toBe(false);
    const busy = { ...overnight, busyUntil: '2026-11-12T23:30:00', busyFor: 'pickup' as const };
    expect(earliestAvailableAt(late, { status: busy, deliveryEnabled: true }).getTime()).toBeGreaterThan(0);
    expect(earliestAvailableAt('nope', { status: busy, deliveryEnabled: false, stepMinutes: 15 }).getTime()).toBeGreaterThan(0);
    expect(isUnavailableAt('nope', { status: busy })).toBe(false);
    expect(isUnavailableAt(noon, { status: busy, now: late, deliveryEnabled: true })).toBe(true);
    expect(formatClockHHmm('')).toMatch(/\d/);
    expect(formatClockHHmm('15:05')).toMatch(/3:05|15:05/);
    const until = new Date(busyUntilFromNow(-4, noon));
    expect(until.getTime()).toBeGreaterThan(noon.getTime());
    const closed = new Date('2026-11-12T23:30:00');
    const spansOpen = {
      openTime: '07:00',
      closeTime: '22:00',
      busyUntil: '2026-11-13T08:00:00',
      busyFor: 'both' as const,
    };
    const earliest = earliestAvailableAt(closed, { status: spansOpen, deliveryEnabled: true });
    expect(earliest.getTime()).toBeGreaterThanOrEqual(new Date('2026-11-13T08:00:00').getTime());
    expect(
      earliestAvailableAt(noon, { status: { ...spansOpen, busyFor: 'delivery' }, deliveryEnabled: false }).getTime(),
    ).toBeGreaterThan(0);
    expect(
      earliestAvailableAt(noon, { status: { ...spansOpen, busyFor: 'pickup' }, deliveryEnabled: false }).getTime(),
    ).toBeGreaterThan(0);
    expect(
      isUnavailableAt(noon, {
        status: { busyUntil: '2026-11-12T18:00:00', busyFor: 'delivery' },
        now: noon,
        deliveryEnabled: false,
      }),
    ).toBe(false);
    expect(nextOpenAt(new Date('2026-11-12T06:00:00'), { openTime: '07:00', closeTime: '22:00' }).getHours()).toBe(7);
  });

  it('covers cart actions, walk-in edges, and held names', () => {
    let state = emptyCart();
    const scout = line({ key: 'a', productId: 'scout', lineTotal: 8000, breakdown: { mint: 1 } });
    state = cartReducer(state, { type: 'replace_lines', lines: [scout] });
    state = cartReducer(state, {
      type: 'update_line',
      key: 'a',
      line: { ...scout, lineTotal: 8000 },
    });
    state = cartReducer(state, { type: 'replace_all', state: { lines: [scout], meta: { clientName: 'A' } as never } });
    state = cartReducer(state, { type: 'reset_meta' });
    expect(cartReducer(state, { type: 'unknown' } as never)).toBe(state);
    expect(cartTotal(null)).toBe(0);
    expect(cloneLines(null as never)).toEqual([]);
    expect(isWalkInCheckout({ clientName: '  ', clientId: '' }, false)).toBe(false);
    expect(clientReadyForCharge({ clientName: '   ', clientId: '' }, false)).toBe(false);
    const blank = toHeldSale(emptyCart(), { name: '   ', now: new Date('2026-11-12T09:05:00Z') });
    expect(blank?.name.startsWith('Held')).toBe(true);
  });

  it('covers catalog, format, geo, history, and luminance edges', () => {
    expect(cookieCategoryId('')).toBe('');
    expect(cookieCategoryId('Cookie_Mint')).toBe('cookie_mint');
    expect(canonicalInventoryCategoryId('')).toBe('');
    expect(cookieUnitPrice('nope')).toBe(5000);
    expect(cookieWholesaleUgx('butterscotch')).toBe(2500);
    expect(cookieLineDisplayName('cookie_trio', {})).toBe('Cookie Trio');
    expect(cookieLineDisplayName('cookie_quartet', {})).toBe('Cookie Quartet');
    expect(cookieLineDisplayName('cookie_wholesale', {})).toBe('Wholesale cookies');
    expect(cookieLineDisplayName('cookie_single', { cookie_mint: 1, cookie_chocolate: 1 })).toBe('Cookies');
    expect(cookieLineDisplayName('cookie_single', { cookie_unknown: 1 })).toMatch(/Unknown|Cookie/);
    expect(normalizeInventoryBreakdown({ cookie: Number.NaN, mint: 1 })).toEqual({ mint: 1 });
    expect(formatUGX(1.6)).toBe('UGX 2');
    expect(formatCompact(2_000_000)).toBe('2M');
    expect(roadKmEstimate(Number.NaN)).toBe(0);
    expect(roadKmEstimate(-3)).toBe(0);
    expect(groupSalesByDay(null)).toEqual([]);
    const grouped = groupSalesByDay([
      { id: 'b', created_at: '2026-11-12T09:00:00', total_ugx: 1000 },
      { id: 'a', created_at: '2026-11-12T08:00:00', total_ugx: Number.NaN },
    ]);
    expect(grouped[0]?.sales.map((s) => s.id)).toEqual(['b', 'a']);
    expect(partitionThisWeek([{ created_at: '2020-01-01', total_ugx: 1 }], new Date('2026-11-12')).older).toHaveLength(1);
    expect(relativeLuminance('')).toBe(0);
    expect(relativeLuminance('#abc')).toBeGreaterThan(0);
    relativeLuminance('#zzzzzz');
    expect(contrastInk('#000', 0)).toBe('ink');
  });

  it('covers stock deltas, today, and sale payload edges', () => {
    expect(mergeSoldBreakdown(null)).toEqual({});
    expect(mergeSoldBreakdown([{ breakdown: { mint: 1 }, stockClaimed: true }])).toEqual({});
    expect(soldDeltas({ nope: 2, mint: 0 })).toEqual({});
    expect(cartSoldDeltas([{ breakdown: { classic: 1 } }])).toEqual({ classic: -1 });
    expect(applySoldToInventory({ mint: 1 }, { mint: 5, missing: 1 })).toEqual({ mint: 0 });
    expect(adjustDraftForItem({ mint: 1 }, null, -1)).toEqual({ mint: 1 });
    expect(adjustDraftForItem({ mint: 1 }, { stockDeferred: true }, -1)).toEqual({ mint: 1 });
    expect(adjustDraftForItem({}, { breakdown: { mint: 2 } }, -1).mint).toBe(-2);
    expect(salesToday(null, new Date())).toEqual([]);
    expect(salesToday([{ created_at: 'nope' }], new Date('2026-11-12')).length).toBe(0);
    expect(
      computeTodayStats(
        [{ created_at: '2026-11-12T10:00:00', items: null, total_ugx: 1000 }],
        new Date('2026-11-12T12:00:00'),
      ).joints,
    ).toBe(0);
    const reward = line({
      key: 'r',
      productId: 'reward',
      isReward: true,
      rewardKey: '',
      pointsCost: -3,
      lineTotal: 8000,
      wholesaleUnitPrice: 0,
    });
    const items = buildSaleItems([reward, line({ key: 'w', productId: 'cookie_wholesale', wholesaleUnitPrice: 2500, lineTotal: 5000 })]);
    expect(items[0]?.line_total).toBe(0);
    expect(items[0]?.points_cost).toBe(0);
    expect(items[1]?.wholesale_unit_price).toBe(2500);
    const fields = buildSaleFulfillmentFields(null, {
      feeValue: '-1',
      distanceKm: Number.NaN,
      durationMin: Number.NaN,
      dest: { lat: Number.NaN, lng: 1 },
    });
    expect(fields.delivery_fee_ugx).toBeNull();
    expect(fields.client_phone).toBeNull();
    expect(fields.delivery_enabled).toBe(true);
    const paid = buildSalePostBody({
      lines: [line({ key: 'p', productId: 'scout', lineTotal: 8000 })],
      meta: { deliveryEnabled: false, clientPhone: '0700' },
      clientId: null,
      isCredit: false,
    });
    expect(paid.credit_cleared).toBe(true);
    expect(paid.amount_paid_ugx).toBe(8000);
  });

  it('covers flavoured bulk and pack config leftovers', () => {
    expect(isCookiePackProduct('')).toBe(false);
    expect(isCookieSingleProduct('cookie_single')).toBe(true);
    expect(isCookiePricedProduct('cookie_duet')).toBe(true);
    expect(flavoredCookiesPerPack('cookie_duet', null)).toBe(2);
    expect(flavoredCookiesPerPack('cookie_duet', {})).toBe(0);
    expect(flavoredCookiesPerPack('cookie_duet', { cookie_butterscotch: 2 })).toBe(0);
    expect(flavoredCookiesPerPack('nope', null)).toBe(0);
    expect(sumFlavoredCookies(null, { excludeKey: 'a', excludeProductId: 'cookie_single' })).toBe(0);
    expect(
      sumFlavoredCookies(
        [
          null,
          { key: 'skip', productId: 'cookie_single', breakdown: { cookie_mint: 2 } },
          { productId: 'cookie_single', breakdown: { cookie_mint: 1 }, isReward: true },
          { product_id: 'cookie_duet', quantity: 2, breakdown: { cookie_chocolate: 2 } },
        ],
        { excludeKey: 'skip' },
      ),
    ).toBe(4);
    expect(packPriceUgx('nope', 10, {})).toBe(0);
    expect(packPriceUgx('cookie_quartet', 1, { cookie_butterscotch: 4 })).toBe(25000);
    expect(singleLineTotalUgx(null, 4)).toBe(0);
    expect(singleLineTotalUgx({ cookie_butterscotch: 2, nope: 0 }, 1)).toBe(10000);
    expect(lineTotalForCookieProduct({ id: 'scout', price: 8000 }, {}, [])).toBe(8000);
    expect(lineTotalForCookieProduct(null, {}, [])).toBe(0);
    expect(applyToCartLines(null)).toBe(false);
    const lines = [
      { is_reward: true, productId: 'cookie_single', breakdown: { cookie_mint: 1 }, lineTotal: 1 },
      { productId: 'cookie_wholesale', breakdown: { cookie_mint: 1 }, lineTotal: 1 },
      { productId: 'cookie_duet', quantity: 2, breakdown: { cookie_mint: 2 }, line_total: 1 },
      { productId: 'scout', lineTotal: 8000 },
      { productId: 'cookie_single', breakdown: { cookie_mint: 4 } },
    ];
    expect(applyToCartLines(lines)).toBe(true);
    expect(getProgress(null).message).toBe('');
    expect(getProgress([{ productId: 'cookie_single', breakdown: { cookie_mint: 1 } }]).message).toMatch(/more cookie/);
    expect(getProgress([{ productId: 'cookie_single', breakdown: { cookie_mint: 4 } }]).unlocked).toBe(true);
    expect(cookieUnitPriceForCount('cookie_mint', 4)).toBe(6500);
    expect(cookieUnitPriceForCount('cookie_butterscotch', 4)).toBe(5000);

    const variety = findProduct('variety')!;
    const quartet = findProduct('cookie_quartet')!;
    const plain = findProduct('plain_single')!;
    const wholesale = findProduct('cookie_wholesale')!;
    expect(breakdownToConfigSelection(null, {})).toEqual({});
    expect(breakdownToConfigSelection(variety, { mint: 1, classic: 1 }).classic).toBeUndefined();
    expect(breakdownToConfigSelection(plain, { classic: 3 }).qty).toBe(3);
    expect(breakdownToConfigSelection({ ...plain, rule: 'other' }, { classic: 1 })).toEqual({});
    expect(configTotalSelected({ _unit: 5, mint: 2, note: 'x' as never })).toBe(2);
    expect(wholesaleUnitPriceFromItem(null)).toBe(0);
    expect(wholesaleUnitPriceFromItem({ breakdown: { cookie_mint: 2 }, line_total: 6000 })).toBe(3000);
    expect(itemToConfigSelection(wholesale, { breakdown: { cookie_mint: 2 }, line_total: 6000 })._unitPrice).toBe(3000);
    const built = buildLineFromConfig(quartet, { cookie_mint: 1, cookie_chocolate: 1, cookie_strawberry: 1 });
    expect(built.detail).toMatch(/Butterscotch/);
    const emptyVariety = buildLineFromConfig(variety, {});
    expect(emptyVariety.detail).toMatch(/Plain|Classic|classic/i);
    expect(buildLineFromConfig(findProduct('spliff_single')!, { spliff5050: 1 }).lineTotal).toBe(5000);
    expect(buildLineFromConfig(findProduct('cookie_single')!, { cookie_mint: 1 }).lineTotal).toBe(8000);
    expect(buildLineFromConfig(wholesale, { cookie_mint: 2, _unitPrice: 2500 }).detail).toMatch(/2,500/);
    expect(buildLineFromConfig(wholesale, { cookie_mint: 2 }).detail).not.toMatch(/each/);
  });

  it('covers revenue recognition edges and partner open batches', () => {
    expect(cookieFlavorEntriesFromItem(null)).toEqual([]);
    expect(cookieFlavorEntriesFromItem({ breakdown: { mint: 1 } })).toEqual([]);
    expect(allocateCookieLineRevenue([], 100)).toEqual([]);
    expect(allocateCookieLineRevenue([{ catId: 'cookie_mint', flavorId: 'mint', qty: 1, unitPrice: 0, wholesale: 0 }], 0)).toEqual([0]);
    const zeroWeight = allocateCookieLineRevenue(
      [{ catId: 'cookie_mint', flavorId: 'mint', qty: 2, unitPrice: 0, wholesale: 0 }],
      100,
      'single',
    );
    expect(zeroWeight[0]).toBe(0);
    expect(expandCookieUnitsFromItem({ breakdown: { cookie_mint: 1 }, line_total: 0 }, 1)).toEqual([]);
    expect(itemCookieSettlement({ breakdown: { mint: 1 }, line_total: 1000 })).toBeNull();
    expect(itemOwnerRevenue({ line_total: 8000 })).toBe(8000);
    expect(saleOwnerRevenue(null)).toBe(0);
    expect(saleOwnerRevenue({ items: [], total_ugx: 4000 })).toBe(4000);
    expect(salePaidRatio(null)).toBe(1);
    expect(salePaidRatio({ is_credit: true, credit_cleared: true, total_ugx: 1000 })).toBe(1);
    expect(salePaidRatio({ is_credit: true, total_ugx: 0 })).toBe(0);
    expect(saleRecognizedOwnerRevenue({ is_credit: true, total_ugx: 0, items: [] })).toBe(0);
    expect(
      itemCookieSettlement({
        product_name: 'Wholesale cookies',
        line_total: 1000,
        breakdown: { cookie_butterscotch: 2 },
      })?.ownerSplit,
    ).toBe(0);
    expect(openPartnerBatches(null, Number.NaN)).toEqual([]);
    expect(
      openPartnerBatches(
        [
          {
            id: 's',
            created_at: '2026-08-13T10:00:00+03:00',
            items: [{ product_id: 'cookie_single', line_total: 8000, breakdown: { cookie_mint: 1 } }],
          },
        ],
        0,
      )[0]?.cookieCount,
    ).toBe(1);
    const partial = cookiePartnerBatchesFromUnits(
      [
        {
          flavorId: 'mint',
          productKind: 'quartet',
          revenue: 1000,
          lineKey: 'q:0',
          lineCookieQty: 4,
        },
        { flavorId: 'nope', productKind: 'wholesale', revenue: 500, lineKey: 'w:0', lineCookieQty: 1 },
      ],
      25,
    );
    expect(partial[0]?.lines.some((row) => row.kind === 'quartet' && row.complete === false)).toBe(true);
    expect(partial[0]?.lines.some((row) => row.kind === 'wholesale')).toBe(true);
    const seed = buildDefaultSeed();
    const tracked = expandPartnerUnitsFromSales(seed.sales);
    expect(tracked.length).toBeGreaterThan(25);
    expect(openPartnerBatches(seed.sales, 25).length).toBeGreaterThan(0);
  });

  it('covers reservation decisions and store-order name fallbacks', () => {
    expect(unitsFromOrderItems(null)).toEqual({});
    expect(unitsFromOrderItems([null, { breakdown: null }, { breakdown: { cookie: 2, nope: 1 } }])).toEqual({
      cookie_butterscotch: 2,
    });
    expect(reservationOf(null)).toBeNull();
    expect(reservationOf({ delivery: [] })).toBeNull();
    expect(reservationOf({ delivery: { stock_reservation: { state: 'nope' } } })).toBeNull();
    const held = reservationOf({
      delivery: {
        stock_reservation: {
          state: 'held',
          claimed: { classic: 1 },
          at: 't',
          consumed_at: 1,
          claim_device: '  phone  ',
        },
      },
    });
    expect(held?.claim_device).toBe('phone');
    expect(decideClaim(held, '  ').ok).toBe(false);
    expect(decideClaim(held, 'phone', { sold: true }).ok).toBe(false);
    expect(decideClaim(held, 'phone', { cancelled: true }).ok).toBe(false);
    expect(decideClaim(null, 'phone').reason).toBe('none');
    expect(decideClaim({ state: 'released', claimed: {} }, 'phone').ok).toBe(false);
    expect(decideClaim({ state: 'consumed', claimed: { classic: 1 } }, 'phone').reason).toBe('already_consumed');
    expect(decideUnclaim(null, 'phone').reason).toBe('none');
    expect(decideUnclaim(held, 'phone', { sold: true }).reason).toBe('none');
    expect(decideUnclaim({ state: 'consumed', claimed: {} }, 'phone').reason).toBe('consumed');
    expect(decideUnclaim(held, 'other').ok).toBe(false);
    const unclaimed = decideUnclaim({ state: 'held', claimed: { classic: 1 }, at: 't' }, 'phone');
    expect(unclaimed.ok && unclaimed.next && !('claim_device' in unclaimed.next)).toBe(true);
    expect(decideConsume(held, 'phone', { sold: true }).ok).toBe(false);
    expect(decideConsume(held, 'phone', { cancelled: true }).ok).toBe(false);
    expect(decideConsume(null, '').reason).toBe('none');
    expect(decideRevert(held, 'phone', { sold: true }).reason).toBe('sold');
    expect(decideRevert(null, 'phone').reason).toBe('none');
    expect(decideRevert({ state: 'consumed', claimed: { classic: 1 }, claim_device: 'a' }, 'b').ok).toBe(false);
    expect(deliveryWithReservation(null, { state: 'held', claimed: {} }).stock_reservation.state).toBe('held');
    expect(deliveryWithReservation(['nope'], { state: 'held', claimed: {} }).stock_reservation).toBeTruthy();
    expect(claimAgainstStock({ classic: 1 }, { classic: 0, mint: -1 }).ok).toBe(true);
    expect(releaseAgainstStock({}, { classic: 0, mint: 2 }).mint).toBe(2);
    expect(shortageMessage({})).toMatch(/Not enough/);
    expect(soldExcludingHold({ mint: 2 }, null)).toEqual({ mint: 2 });
    expect(soldExcludingHold({ mint: 2 }, { mint: 1, classic: 1 }).mint).toBe(1);
    expect(soldExcludingHold({ mint: 1 }, { mint: 2 }).mint).toBeUndefined();
    expect(counterSellable({ mint: 3 }, null).mint).toBe(3);
    expect(counterSellable({ mint: 3 }, [null as never, { stockDeferred: true, breakdown: { mint: 2 } }, { breakdown: { nope: 1 } }]).mint).toBe(3);
    expect(availableFromPools(() => null, { slots: 2, fixed: null, pool: ['mint'] })).toBeNull();
    expect(availableFromPools(() => null, { slots: 2, fixed: 'classic', pool: ['mint'] })).toBeNull();

    expect(resolveStoreLineName({ product_name: 'Cookies', product_id: 'cookie_single', breakdown: { cookie_mint: 1 } }, findProduct('cookie_single'))).toBe('Mint Cookie');
    expect(resolveStoreLineName({ product_name: '', product_id: 'nope' }, undefined)).toBe('Item');
    expect(rowsToCartLines(null)).toEqual([]);
    const mapped = rowsToCartLines([{ product_id: 'plain_single', line_total: '12' as never }], { rand: () => 0.5, now: 1 });
    expect(mapped[0]?.breakdown).toEqual({});
    expect(mapStoreOrderToCart({ id: 'o', delivery_enabled: false, items: [] }).meta.deliveryEnabled).toBe(false);
  });

  it('covers stock level options and rank fallbacks', () => {
    expect(stockLevel('cookie_mint', 3, { cookieCapacity: 10, cookieLowPct: 0.5, lowThreshold: 1 })).toBe('low');
    expect(stockLevel('mint', 1, { lowThreshold: 1 })).toBe('ok');
    expect(stockLevel('mint', 0)).toBe('out');
    expect(stockCrossing('mint', 0, 0).recovered).toBe(false);
    expect(stockCrossing('mint', 1, 0).crossedOut).toBe(true);
    expect(topProductForSales(null)).toEqual({ topProduct: '—', topCount: 0 });
    expect(topProductForSales([{ items: null }]).topProduct).toBe('—');
    expect(canonicalProductName('Plain')).toBe('Plain');
    expect(revenueDelta(10, 10).cls).toBe('neutral');
  });
});
