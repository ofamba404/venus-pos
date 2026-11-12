/**
 * Dual-run the fee model's fit, quote, range, and confidence helpers.
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as legacy from '../../legacy/js/delivery-fee-model.js';
import * as next from '../../src/domain/delivery-fee.ts';

type Row = {
  fee_ugx: number;
  distance_km: number;
  duration_min?: number | null;
  created_at?: string | null;
  dest_lat?: number | null;
  dest_lng?: number | null;
};

function compareModels(rows: Row[]) {
  const a = legacy.fitDeliveryFeeModel(rows);
  const b = next.fitDeliveryFeeModel(rows);
  if (a === null || b === null) {
    expect(b).toBeNull();
    expect(a).toBeNull();
    return;
  }
  expect(b.r2).toBeCloseTo(a.r2, 6);
  expect(b.core.kmRate).toBeCloseTo(a.core.kmRate, 6);
  const dest = rows.find((r) => r.dest_lat !== null && r.dest_lat !== undefined && r.dest_lng !== null && r.dest_lng !== undefined);
  for (const km of [0, 1.2, 4, 8, 14, 30, 55, Number.NaN]) {
    const opts = {
      durationMin: 20,
      period: 'night' as const,
      at: '2026-11-12T22:00:00+03:00',
      dest: dest ? { lat: dest.dest_lat as number, lng: dest.dest_lng as number } : null,
    };
    expect(next.quoteFee(km, b, opts)).toBe(legacy.quoteFee(km, a, opts));
    expect(next.quoteFeeRange(km, b, opts)).toEqual(legacy.quoteFeeRange(km, a, opts));
    const rawA = legacy.rawQuoteFee(km, a, opts);
    const rawB = next.rawQuoteFee(km, b, opts);
    if (rawA === null || rawB === null) expect(rawB).toBe(rawA);
    else expect(rawB).toBeCloseTo(rawA, 5);
    expect(next.predictSafeBodaFee(km, b, opts)).toBe(legacy.predictSafeBodaFee(km, a, opts));
    expect(next.predictSafeBodaFeeRange(km, b, opts)).toEqual(
      legacy.predictSafeBodaFeeRange(km, a, opts),
    );
    const minsA = legacy.estimateDurationMin(km, a);
    const minsB = next.estimateDurationMin(km, b);
    if (minsA === null || minsB === null) expect(minsB).toBe(minsA);
    else expect(minsB).toBeCloseTo(minsA, 6);
  }
  expect(next.modelConfidence(b)).toEqual(legacy.modelConfidence(a));
  expect(next.formatPremiumVsDay(b, 'evening_peak')).toBe(legacy.formatPremiumVsDay(a, 'evening_peak'));
}

describe('delivery quote dual-run', () => {
  it('matches empty, short, and negative-slope fits', () => {
    compareModels([]);
    compareModels([{ fee_ugx: 4000, distance_km: 2 }]);
    compareModels([
      { fee_ugx: 9000, distance_km: 1 },
      { fee_ugx: 3000, distance_km: 10 },
    ]);
    compareModels([
      { fee_ugx: Number.NaN, distance_km: 2 },
      { fee_ugx: 4000, distance_km: -1 },
      { fee_ugx: 5000, distance_km: 3, duration_min: 0, created_at: 'not-a-date' },
    ]);
    compareModels([
      { fee_ugx: 4000, distance_km: 5, duration_min: 10, created_at: '2026-11-12T12:00:00+03:00' },
      { fee_ugx: 9000, distance_km: 5, duration_min: 12, created_at: '2026-11-12T12:30:00+03:00' },
    ]);
  });

  it('matches a confident fit, a slow trip, and a remembered drop-off', () => {
    const linear = Array.from({ length: 12 }, (_, i) => ({
      fee_ugx: 3000 + (i + 1) * 800,
      distance_km: i + 1,
      duration_min: (i + 1) * 4,
      created_at: '2026-11-12T11:00:00+03:00',
      dest_lat: 0.34,
      dest_lng: 32.57,
    }));
    compareModels(linear);
    const fitted = next.fitDeliveryFeeModel(linear);
    const legacyFitted = legacy.fitDeliveryFeeModel(linear);
    expect(next.rawQuoteFee(10, fitted, {})).toBeCloseTo(legacy.rawQuoteFee(10, legacyFitted, {}), 5);
    expect(next.rawQuoteFee(10, fitted, { at: '2026-11-12T07:00:00+03:00' })).toBeCloseTo(
      legacy.rawQuoteFee(10, legacyFitted, { at: '2026-11-12T07:00:00+03:00' }),
      5,
    );
    expect(next.rawQuoteFee(10, fitted, { durationMin: Number.NaN, period: 'day' })).toBeCloseTo(
      legacy.rawQuoteFee(10, legacyFitted, { durationMin: Number.NaN, period: 'day' }),
      5,
    );
    expect(next.estimateDurationMin(4, {})).toBeCloseTo(legacy.estimateDurationMin(4, {}), 6);
    expect(next.estimateDurationMin(4, { avgSpeedKmh: 0 })).toBe(legacy.estimateDurationMin(4, { avgSpeedKmh: 0 }));
    const slow = linear.map((row, i) => ({
      ...row,
      duration_min: row.duration_min + (i % 3 === 0 ? 40 : 0),
      created_at: i % 2 === 0 ? '2026-11-12T07:30:00+03:00' : '2026-11-12T18:30:00+03:00',
    }));
    compareModels(slow);
    expect(next.modelConfidence(null)).toEqual(legacy.modelConfidence(null));
    expect(next.formatPremiumVsDay(null, 'day')).toBeNull();
    expect(next.estimateDurationMin(null, null)).toBeNull();
    expect(next.estimateDurationMin(-2, { avgSpeedKmh: 0 })).toBeNull();
    expect(next.quoteFee(null, { core: {} })).toBe(0);
    expect(next.predictSafeBodaFee(1, null)).toBeNull();
    expect(next.predictSafeBodaFeeRange(Number.NaN, { core: {} })).toBeNull();
    expect(next.kampalaHour('nope')).toBe(legacy.kampalaHour('nope'));
    expect(next.periodForHour(-5)).toBe(legacy.periodForHour(-5));
    expect(next.periodForHour(30)).toBe(legacy.periodForHour(30));
    expect(next.periodMeta('nope')).toEqual(legacy.periodMeta('nope'));
    expect(next.listPeriods().map((p: { id: string }) => p.id)).toEqual(
      legacy.listPeriods().map((p: { id: string }) => p.id),
    );
    for (const r2 of [0.95, 0.8, 0.6, 0.2, 0]) {
      expect(next.modelConfidence({ r2 })).toEqual(legacy.modelConfidence({ r2 }));
    }
  });

  it('matches random quote logs (2000 runs)', () => {
    const row = fc.record({
      fee_ugx: fc.integer({ min: 2000, max: 20000 }),
      distance_km: fc.double({ min: 0, max: 25, noNaN: true }),
      duration_min: fc.option(fc.integer({ min: 1, max: 90 }), { nil: null }),
      created_at: fc.constantFrom(
        '2026-06-01T05:00:00+03:00',
        '2026-06-01T08:00:00+03:00',
        '2026-06-01T12:00:00+03:00',
        '2026-06-01T18:00:00+03:00',
        null,
      ),
      dest_lat: fc.option(fc.double({ min: 0.3, max: 0.4, noNaN: true }), { nil: null }),
      dest_lng: fc.option(fc.double({ min: 32.5, max: 32.7, noNaN: true }), { nil: null }),
    });
    fc.assert(
      fc.property(fc.array(row, { minLength: 0, maxLength: 10 }), (rows) => {
        compareModels(rows);
      }),
      { numRuns: 2000 },
    );
  });
});
