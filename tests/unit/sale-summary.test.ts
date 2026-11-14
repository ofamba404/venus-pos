import { describe, expect, it } from 'vitest';
import { saleFee, saleSummaryLines, type SaleSummaryLine } from '../../src/domain/sale-summary';
import type { CartLine } from '../../src/domain/cart';
import {
  nextWaitingOrder,
  waitingOrderName,
  waitingOrderPrompt,
  waitingOrderTotal,
} from '../../src/features/orders/next-waiting';
import type { StoreOrderRow } from '../../src/data/entities';

function line(partial: Partial<CartLine> & Pick<CartLine, 'name' | 'productId'>): CartLine {
  return {
    key: partial.key || partial.productId,
    detail: '',
    breakdown: {},
    lineTotal: 0,
    ...partial,
  };
}

describe('saleSummaryLines', () => {
  it('keeps the name, pack quantity and amount', () => {
    const rows = saleSummaryLines([
      line({ productId: 'pilot', name: 'Pilot Pack', quantity: 1, lineTotal: 15000, breakdown: { mint: 2, grape: 1 } }),
      line({ productId: 'plain_single', name: 'Plain', quantity: 2, lineTotal: 10000, breakdown: { classic: 2 } }),
    ]);
    expect(rows).toEqual<SaleSummaryLine[]>([
      { name: 'Pilot Pack', qty: 1, total: 15000, productId: 'pilot', breakdown: { mint: 2, grape: 1 } },
      { name: 'Plain', qty: 2, total: 10000, productId: 'plain_single', breakdown: { classic: 2 } },
    ]);
  });

  it('records a reward line as 0', () => {
    const rows = saleSummaryLines([
      line({ productId: 'plain_single', name: 'Plain', quantity: 1, lineTotal: 5000, isReward: true }),
    ]);
    expect(rows[0]!.total).toBe(0);
  });
});

describe('saleFee', () => {
  it('is null when the sale had no delivery', () => {
    expect(saleFee(false, '7000')).toBeNull();
    expect(saleFee(false, 0)).toBeNull();
  });

  it('keeps a delivery fee of 0, and ignores a blank or bad value', () => {
    expect(saleFee(true, '0')).toBe(0);
    expect(saleFee(true, 7000)).toBe(7000);
    expect(saleFee(true, '')).toBeNull();
    expect(saleFee(true, 'x')).toBeNull();
  });
});

function order(partial: Partial<StoreOrderRow> & Pick<StoreOrderRow, 'id'>): StoreOrderRow {
  return { status: 'pending', items: [], ...partial };
}

describe('nextWaitingOrder', () => {
  it('returns the first waiting order and skips closed ones', () => {
    const rows = [
      order({ id: 'closed', status: 'checked_out', customer_name: 'Done' }),
      order({ id: 'cancelled', status: 'cancelled', customer_name: 'Out' }),
      order({
        id: 'next',
        status: 'pending',
        customer_name: 'Bryan',
        items: [{ product_id: 'plain_single', line_total: 10000 }],
      }),
      order({ id: 'later', status: 'confirmed', customer_name: 'Muza' }),
    ];
    const next = nextWaitingOrder(rows);
    expect(next?.id).toBe('next');
    expect(waitingOrderPrompt(next!).label).toBe('Next: Bryan · UGX 10,000');
    expect(waitingOrderPrompt(next!).label.toLowerCase()).not.toContain('customer');
  });

  it('is null when nothing is waiting', () => {
    expect(nextWaitingOrder([order({ id: 'x', status: 'cancelled' })])).toBeNull();
    expect(nextWaitingOrder([])).toBeNull();
  });

  it('adds a known delivery fee to the prompt total', () => {
    const row = order({
      id: 'd',
      customer_name: 'Muza',
      delivery_enabled: true,
      delivery_fee_ugx: 7000,
      items: [{ product_id: 'pilot', line_total: 15000 }],
    });
    expect(waitingOrderTotal(row)).toBe(22000);
    expect(waitingOrderName(row)).toBe('Muza');
    expect(waitingOrderPrompt(row).label).toBe('Next: Muza · UGX 22,000');
  });

  it('prefers the order pos_display_name over customer_name', () => {
    const row = order({ id: 'a', customer_name: 'Snap Name', pos_display_name: 'Buyer One' });
    expect(waitingOrderName(row)).toBe('Buyer One');
  });
});
