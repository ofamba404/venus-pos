import { describe, expect, it } from 'vitest';
import {
  batchBarSquares,
  openPartnerBatches,
  partnerBoard,
  proposeSettle,
  sanitizeCookiePartnerSettled,
  type PartnerUnit,
} from '../../src/domain/partner';

const REAL_CUTS = [...Array.from({ length: 10 }, () => 25), 12];

function units(count: number): PartnerUnit[] {
  return Array.from({ length: count }, () => ({ revenue: 8000, ownerSplit: 2000, partnerDue: 6000 }));
}

describe('cookie partner server state', () => {
  it('shows the live blob: 262 settled, batch 12 open at 23/25', () => {
    const board = partnerBoard(units(285), 262, REAL_CUTS);
    expect(board.settledQty).toBe(262);
    expect(board.settled).toHaveLength(11);
    expect(board.settled.slice(0, 10).every((batch) => batch.cookieCount === 25 && batch.complete)).toBe(true);
    expect(board.settled[10]).toMatchObject({ cookieCount: 12, complete: false });
    expect(board.open).toMatchObject({ index: 12, cookieCount: 23, every: 25, complete: false });
  });

  it('falls back when cuts or units are missing and rejects a corrupt total', () => {
    expect(partnerBoard(null, Number.NaN, []).open).toBeNull();
    expect(partnerBoard(units(30), 10, null).settled.every((batch) => batch.complete)).toBe(true);
    expect(sanitizeCookiePartnerSettled(Number.NaN, 40)).toBe(25);
    expect(sanitizeCookiePartnerSettled(-1, 40)).toBe(25);
    expect(sanitizeCookiePartnerSettled(40, 40)).toBe(25);
    expect(sanitizeCookiePartnerSettled(10, Number.NaN)).toBe(10);
    expect(sanitizeCookiePartnerSettled(10, 40)).toBe(10);
    expect(sanitizeCookiePartnerSettled(3.2, 10)).toBe(3);
    expect(openPartnerBatches(null, 0)).toEqual([]);
    expect(
      openPartnerBatches(
        [
          {
            created_at: '2026-08-20T00:00:00+03:00',
            items: [{ product_id: 'cookie_single', line_total: 8000, breakdown: { cookie_mint: 1 } }],
          },
        ],
        0,
      ).length,
    ).toBe(1);
  });

  it('refuses a lower or empty settlement', () => {
    expect(proposeSettle(262, REAL_CUTS, 0)).toBeNull();
    expect(proposeSettle(262, REAL_CUTS, -4)).toBeNull();
    expect(proposeSettle(262, REAL_CUTS, 23)).toEqual({
      qty: 285,
      batches: [...REAL_CUTS, 23],
    });
  });
});

describe('batch progress squares', () => {
  const of = (flavorId: string, n: number): PartnerUnit[] => Array.from({ length: n }, () => ({ flavorId }));

  it('batch 12: 21 chocolate, 2 mint, 2 empty, in storefront colours', () => {
    // Sold mint first, then chocolate: the bar still stacks chocolate before mint.
    const bar = batchBarSquares([...of('mint', 1), ...of('chocolate', 21), ...of('mint', 1)]);
    expect(bar.squares).toHaveLength(23);
    expect(bar.empty).toBe(2);
    expect(bar.squares.slice(0, 21).every((s) => s.flavorId === 'chocolate' && s.color === '#5c2e1f')).toBe(true);
    expect(bar.squares.slice(21).map((s) => [s.flavorId, s.color])).toEqual([
      ['mint', '#3CB043'],
      ['mint', '#3CB043'],
    ]);
    expect(bar.groups.map((g) => `${g.count} ${g.name}`)).toEqual(['21 Chocolate', '2 Mint']);
  });

  it('keeps a stable flavour order, maps the bare cookie to butterscotch and caps at the batch size', () => {
    const bar = batchBarSquares([...of('butterscotch', 1), ...of('strawberry', 1), ...of('cookie_mint', 1), ...of('', 1), ...of('chocolate', 1)]);
    expect(bar.groups.map((g) => [g.flavorId, g.color])).toEqual([
      ['chocolate', '#5c2e1f'],
      ['mint', '#3CB043'],
      ['strawberry', '#d81e2c'],
      ['butterscotch', '#D4A355'],
    ]);
    expect(bar.groups[3]!.count).toBe(2);
    expect(batchBarSquares(of('mint', 40)).squares).toHaveLength(25);
    expect(batchBarSquares(null)).toMatchObject({ squares: [], empty: 25 });
    expect(batchBarSquares(of('lavender', 2)).groups[0]).toMatchObject({ flavorId: 'lavender', name: 'lavender' });
  });
});
