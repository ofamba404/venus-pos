import { describe, expect, it } from 'vitest';
import { stockLevel, stockCrossing } from '../../src/domain/stock-state';

describe('stockLevel', () => {
  it('marks joints out/low/ok by threshold 5 (legacy uses <, so 5 is ok)', () => {
    expect(stockLevel('mint', 0)).toBe('out');
    expect(stockLevel('mint', 4)).toBe('low');
    expect(stockLevel('mint', 5)).toBe('ok');
  });

  it('marks cookies low under 30% of capacity 100', () => {
    expect(stockLevel('cookie_mint', 25)).toBe('low');
    expect(stockLevel('cookie_mint', 30)).toBe('ok');
  });
});

describe('stockCrossing', () => {
  it('detects low and out crossings', () => {
    expect(stockCrossing('mint', 10, 4)).toEqual({
      crossedLow: true,
      crossedOut: false,
      recovered: false,
    });
    expect(stockCrossing('mint', 2, 0)).toEqual({
      crossedLow: false,
      crossedOut: true,
      recovered: false,
    });
  });
});
