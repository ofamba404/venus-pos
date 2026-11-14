import { describe, expect, it } from 'vitest';
import { cartFulfilment, saleFulfilmentLabel, saleSummaryLines, type SaleSummaryLine } from '../../src/domain/sale-summary';
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

describe('saleFulfilmentLabel', () => {
  it('names delivery, pickup and a walk-in counter sale', () => {
    expect(saleFulfilmentLabel('delivery')).toBe('Delivery');
    expect(saleFulfilmentLabel('pickup')).toBe('Pickup');
    expect(saleFulfilmentLabel('walk-in')).toBe('Walk-in');
  });
});

describe('cartFulfilment', () => {
  it('is Walk-in for a counter sale, even if the cart still defaults to delivery', () => {
    expect(cartFulfilment({ deliveryEnabled: true, place: '' })).toBe('walk-in');
    expect(cartFulfilment({ deliveryEnabled: true, place: '  ' })).toBe('walk-in');
  });
  it('is Delivery only when a drop-off was set, and Pickup when that was chosen', () => {
    expect(cartFulfilment({ deliveryEnabled: true, place: 'Kololo' })).toBe('delivery');
    expect(cartFulfilment({ deliveryEnabled: false, place: 'Kololo' })).toBe('pickup');
    expect(cartFulfilment({ deliveryEnabled: false, place: '' })).toBe('pickup');
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

  it('does not count a delivery fee in the prompt total', () => {
    const row = order({
      id: 'd',
      customer_name: 'Muza',
      delivery_enabled: true,
      delivery_fee_ugx: 7000,
      items: [{ product_id: 'pilot', line_total: 15000 }],
    });
    expect(waitingOrderTotal(row)).toBe(15000);
    expect(waitingOrderName(row)).toBe('Muza');
    expect(waitingOrderPrompt(row).label).toBe('Next: Muza · UGX 15,000');
  });

  it('prefers the order pos_display_name over customer_name', () => {
    const row = order({ id: 'a', customer_name: 'Snap Name', pos_display_name: 'Buyer One' });
    expect(waitingOrderName(row)).toBe('Buyer One');
  });
});
