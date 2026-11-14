import { describe, expect, it } from 'vitest';
import { reviewBarMeta, storeOrderItemStats, storeOrderName } from '../../src/domain/store-order-review';

const one = {
  customer_name: 'Venus Prime',
  items: [{ product_id: 'plain_single', product_name: 'Plain', line_total: 5000, breakdown: { mint: 1 } }],
};

const two = {
  customer_name: 'Ada',
  items: [{ product_id: 'scout', product_name: 'Scout Pack', line_total: 8000, breakdown: { mint: 1 } }],
};

describe('store order review bar', () => {
  it('names a client and falls back', () => {
    expect(storeOrderName(one)).toBe('Venus Prime');
    expect(storeOrderName({})).toBe('Store order');
  });

  it('counts lines and an items-only total', () => {
    expect(storeOrderItemStats(one)).toEqual({ count: 1, total: 5000 });
  });

  it('labels one order like the cart bar', () => {
    expect(reviewBarMeta([one])).toBe('Venus Prime · 1 item · UGX 5,000');
  });

  it('labels several orders as a count and combined items total', () => {
    expect(reviewBarMeta([one, two])).toBe('2 orders · UGX 13,000');
  });
});
