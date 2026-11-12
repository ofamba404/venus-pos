import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/data/entities', () => ({
  adjustInventory: vi.fn(),
  loadSales: vi.fn(),
}));
vi.mock('../../src/data/writes/sales', () => ({ deleteSale: vi.fn(), patchSale: vi.fn() }));

import {
  flavourProduct,
  flavourSelection,
  reflavourLine,
  selectionCount,
} from '../../src/data/sale-edit';

const scout = {
  product_id: 'scout',
  product_name: 'Scout Pack',
  detail: 'Mint x1',
  line_total: 8000,
  breakdown: { mint: 1 },
};
const duet = {
  product_id: 'cookie_duet',
  product_name: 'Cookie Duet',
  detail: 'Mint x1, Chocolate x1',
  line_total: 15000,
  breakdown: { cookie_mint: 1, cookie_chocolate: 1 },
};
const plain = { product_id: 'plain_single', product_name: 'Plain', line_total: 5000, breakdown: { classic: 1 } };

describe('sale edit flavours', () => {
  it('knows which lines can be re-picked', () => {
    expect(flavourProduct(scout)?.id).toBe('scout');
    expect(flavourProduct(duet)?.id).toBe('cookie_duet');
    expect(flavourProduct(plain)).toBeNull();
    expect(flavourProduct({ product_id: 'gone' })).toBeNull();
    expect(flavourProduct(null)).toBeNull();
  });

  it('starts the picker on the sale line’s own flavours', () => {
    expect(flavourSelection(scout)).toEqual({ mint: 1 });
    expect(flavourSelection(duet)).toEqual({ cookie_mint: 1, cookie_chocolate: 1 });
    expect(selectionCount({ mint: 2, _unitPrice: 2500 })).toBe(2);
  });

  it('swaps a pack flavour and keeps its price', () => {
    const next = reflavourLine([scout, plain], 0, { strawberry: 1 });
    expect(next[0]!.breakdown).toEqual({ strawberry: 1 });
    expect(next[0]!.line_total).toBe(8000);
    expect(next[0]!.product_name).toBe('Scout Pack');
    expect(next[0]!.detail).toContain('Strawberry');
    expect(next[1]).toEqual(plain);
    expect(scout.breakdown).toEqual({ mint: 1 });
  });

  it('reprices cookie lines when the mix changes the bulk flavoured count', () => {
    const single = {
      product_id: 'cookie_single',
      product_name: 'Cookie',
      line_total: 8000,
      breakdown: { cookie_mint: 1 },
    };
    const next = reflavourLine([duet, single], 1, { cookie_mint: 2, cookie_strawberry: 2 });
    expect(next[1]!.line_total).toBe(6500 * 4);
    expect(next[0]!.line_total).toBe(6500 * 2);
  });

  it('keeps the wholesale unit price', () => {
    const wholesale = {
      product_id: 'cookie_wholesale',
      product_name: 'Wholesale cookies',
      line_total: 5000,
      wholesale_unit_price: 2500,
      breakdown: { cookie_mint: 2 },
    };
    const sel = flavourSelection(wholesale);
    expect(sel._unitPrice).toBe(2500);
    const next = reflavourLine([wholesale], 0, { ...sel, cookie_mint: 4 });
    expect(next[0]!.line_total).toBe(10000);
    expect(next[0]!.wholesale_unit_price).toBe(2500);
  });

  it('leaves lines it cannot re-pick alone', () => {
    const items = [plain];
    expect(reflavourLine(items, 0, { classic: 3 })).toBe(items);
    expect(reflavourLine(items, 5, {})).toBe(items);
  });
});
