/**
 * Dual-run: owner revenue recognition vs legacy revenue.js.
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
  salePaidRatio,
  saleOwnerRevenue,
  saleRecognizedOwnerRevenue,
  sumOwnerRevenue,
  itemOwnerRevenue,
  itemCookieSettlement,
} from '../../legacy/js/revenue.js';
import * as next from '../../src/domain/revenue.ts';

describe('revenue dual-run', () => {
  it('matches paid ratio / recognition for cash and credit', () => {
    const cash = { is_credit: false, total_ugx: 15000, items: [{ line_total: 15000, breakdown: { mint: 2 } }] };
    const credit = {
      is_credit: true,
      credit_cleared: false,
      total_ugx: 20000,
      amount_paid_ugx: 5000,
      items: [{ line_total: 20000, breakdown: { mint: 1 } }],
    };
    expect(next.salePaidRatio(cash)).toBe(salePaidRatio(cash));
    expect(next.salePaidRatio(credit)).toBe(salePaidRatio(credit));
    expect(next.saleOwnerRevenue(cash)).toBe(saleOwnerRevenue(cash));
    expect(next.saleRecognizedOwnerRevenue(credit)).toBe(saleRecognizedOwnerRevenue(credit));
    expect(next.sumOwnerRevenue([cash, credit])).toBe(sumOwnerRevenue([cash, credit]));
  });

  it('matches cookie settlement / owner split', () => {
    const item = {
      product_id: 'cookie_single',
      line_total: 16000,
      breakdown: { cookie_mint: 2 },
    };
    expect(next.itemCookieSettlement(item)).toEqual(itemCookieSettlement(item));
    expect(next.itemOwnerRevenue(item)).toBe(itemOwnerRevenue(item));
  });
});
