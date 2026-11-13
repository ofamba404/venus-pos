import { afterEach, describe, expect, it } from 'vitest';
import { helperConfig, helperWorked, kampalaDay } from '../../src/domain/economics';
import { profitPicture, type DecisionSale } from '../../src/domain/decisions';
import { buildDefaultSeed } from '../fixtures/seed';

afterEach(() => {
  helperConfig.since = null;
});

describe('helper start day', () => {
  it('has no helper at all until a start day is set', () => {
    expect(helperWorked('2020-01-01T10:00:00.000Z')).toBe(false);
    expect(helperWorked('2026-11-12T10:00:00.000Z')).toBe(false);
    helperConfig.since = '2026-11-10';
    expect(helperWorked('2026-11-09T10:00:00.000Z')).toBe(false);
    expect(helperWorked('2026-11-10T10:00:00.000Z')).toBe(true);
    expect(helperWorked('2026-11-12T10:00:00.000Z')).toBe(true);
  });

  it('reads the day in Kampala, not UTC', () => {
    // 22:30 UTC on the 9th is 01:30 on the 10th in Kampala.
    expect(kampalaDay('2026-11-09T22:30:00.000Z')).toBe('2026-11-10');
    expect(kampalaDay('nonsense')).toBe('');
    expect(helperWorked('2026-11-09T22:30:00.000Z', '2026-11-10')).toBe(true);
  });

  it('gives the owner the whole share while no helper has started, and before the start day', () => {
    const sales = buildDefaultSeed().sales as unknown as DecisionSale[];
    // Unset: no helper, every day is the owner's.
    expect(profitPicture(sales, null).helper).toBe(0);
    helperConfig.since = '2000-01-01';
    const all = profitPicture(sales, null);
    expect(all.helper).toBeGreaterThan(0);
    helperConfig.since = '2999-01-01';
    const none = profitPicture(sales, null);
    expect(none.helper).toBe(0);
    expect(Math.abs(none.owner - (all.owner + all.helper))).toBeLessThanOrEqual(sales.length * 4 + 4);
    expect(none.partner).toBe(all.partner);
  });
});
