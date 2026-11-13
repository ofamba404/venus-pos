import { describe, expect, it } from 'vitest';
import { configReady, configTotalSelected } from '../../src/domain/pricing/pack-config';
import { findProduct } from '../../src/domain/pricing/pack-config';
import {
  addConfiguredLine,
  bumpLine,
  canDecrement,
  isCountLine,
  lineQuantity,
  mergeBreakdown,
  newItemSelection,
  saleItemsTotal,
  setLineQty,
} from '../../src/data/sale-edit';

const pilot = () => ({
  product_id: 'pilot',
  product_name: 'Pilot Pack',
  detail: 'Mint x1, Grape x1',
  line_total: 15000,
  breakdown: { mint: 1, grape: 1 } as Record<string, number>,
});
const plain = (n: number) => ({
  product_id: 'plain_single',
  product_name: 'Plain',
  detail: `x${n}`,
  line_total: 5000 * n,
  breakdown: { classic: n } as Record<string, number>,
});

describe('edit-sale stepper', () => {
  it('+ on a pack adds a whole pack and never multiplies the first flavour, so a line cannot exceed its cap', () => {
    const next = bumpLine([pilot()], 0, 1);
    expect(next).toHaveLength(2);
    for (const line of next) {
      expect(line.breakdown).toEqual({ mint: 1, grape: 1 });
      expect(configTotalSelected(line.breakdown as Record<string, number>)).toBe(findProduct('pilot')!.joints);
      expect(configReady(findProduct('pilot'), line.breakdown as Record<string, number>)).toBe(true);
    }
    expect(saleItemsTotal(next)).toBe(30000);
  });

  it('- on a pack only removes one of two identical packs', () => {
    const two = bumpLine([pilot()], 0, 1);
    expect(canDecrement([pilot()], 0)).toBe(false);
    expect(bumpLine([pilot()], 0, -1)).toHaveLength(1);
    expect(canDecrement(two, 0)).toBe(true);
    expect(bumpLine(two, 0, -1)).toHaveLength(1);
  });

  it('a pack line reads as one pack, a Plain line as its count', () => {
    expect(isCountLine(pilot())).toBe(false);
    expect(lineQuantity(pilot())).toBe(1);
    expect(isCountLine(plain(3))).toBe(true);
    expect(lineQuantity(plain(3))).toBe(3);
  });

  it('a count line changes its count and price per unit', () => {
    const up = bumpLine([plain(2)], 0, 1)[0]!;
    expect(up.breakdown).toEqual({ classic: 3 });
    expect(up.line_total).toBe(15000);
    expect(bumpLine([plain(1)], 0, -1)[0]!.breakdown).toEqual({ classic: 1 });
    expect(setLineQty([pilot()], 0, 9)[0]!.breakdown).toEqual({ mint: 1, grape: 1 });
  });
});

describe('Add item to a sale', () => {
  const existing = [{ product_id: 'scout', product_name: 'Scout Pack', detail: 'Mint', line_total: 8000, breakdown: { mint: 1 } }];

  it('adds a Pilot pack with 2 flavours, priced like Sell', () => {
    const product = findProduct('pilot')!;
    const next = addConfiguredLine(existing, product, { mint: 1, grape: 1 });
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({ product_id: 'pilot', product_name: 'Pilot Pack', line_total: 15000, breakdown: { mint: 1, grape: 1 } });
    expect(saleItemsTotal(next)).toBe(23000);
    expect(mergeBreakdown(next)).toEqual({ mint: 2, grape: 1 });
  });

  it('adds a cookie', () => {
    const product = findProduct('cookie_single')!;
    const next = addConfiguredLine(existing, product, { cookie_chocolate: 1 });
    expect(next[1]).toMatchObject({ product_id: 'cookie_single', breakdown: { cookie_chocolate: 1 } });
    expect(Number(next[1]!.line_total)).toBeGreaterThan(0);
    expect(saleItemsTotal(next)).toBe(8000 + Number(next[1]!.line_total));
  });

  it('adds Plain with the same starting count as Sell', () => {
    const product = findProduct('plain_single')!;
    expect(newItemSelection(product)).toEqual({ qty: 1 });
    const next = addConfiguredLine(existing, product, { qty: 2 });
    expect(next[1]).toMatchObject({ breakdown: { classic: 2 }, line_total: 10000 });
  });

  it('the picker only lets a pack through on its exact joint count', () => {
    const product = findProduct('pilot')!;
    expect(configReady(product, { mint: 1 })).toBe(false);
    expect(configReady(product, { mint: 1, grape: 1 })).toBe(true);
    expect(configReady(product, { mint: 2, grape: 1 })).toBe(false);
  });
});
