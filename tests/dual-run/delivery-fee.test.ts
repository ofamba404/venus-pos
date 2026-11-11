/**
 * Dual-run: delivery fee constants / periods / rounding.
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  FEE_STEP_UGX,
  MIN_FARE_UGX,
  kampalaHour,
  periodForHour,
  periodForDate,
  roundFeeToNearest500,
  roundFeeDown500,
  roundFeeUp500,
} from '../../legacy/js/delivery-fee-model.js';
import * as next from '../../src/domain/delivery-fee.ts';

describe('delivery-fee dual-run', () => {
  it('matches constants', () => {
    expect(next.FEE_STEP_UGX).toBe(FEE_STEP_UGX);
    expect(next.MIN_FARE_UGX).toBe(MIN_FARE_UGX);
  });

  it('matches period helpers', () => {
    for (const h of [0, 5, 6, 8, 9, 15, 16, 19, 20, 23]) {
      expect(next.periodForHour(h)).toBe(periodForHour(h));
    }
    const d = new Date('2026-11-12T10:00:00Z');
    expect(next.kampalaHour(d)).toBe(kampalaHour(d));
    expect(next.periodForDate(d)).toBe(periodForDate(d));
  });

  it('matches fee rounding (2000 runs)', () => {
    fc.assert(
      fc.property(fc.double({ min: -100, max: 100000, noNaN: true }), (fee) => {
        expect(next.roundFeeToNearest500(fee)).toBe(roundFeeToNearest500(fee));
        expect(next.roundFeeDown500(fee)).toBe(roundFeeDown500(fee));
        expect(next.roundFeeUp500(fee)).toBe(roundFeeUp500(fee));
      }),
      { numRuns: 2000 },
    );
  });
});
