import { describe, expect, it } from 'vitest';
import { orderSegment } from '../../src/domain/order-segment';
import { isOrderConfirmed } from '../../src/features/orders/confirm-order';

describe('orderSegment', () => {
  it('puts pending orders in Waiting', () => {
    expect(orderSegment({ status: 'pending' })).toBe('waiting');
  });
  it('puts confirmed and accepted orders in In sale', () => {
    expect(orderSegment({ status: 'confirmed' })).toBe('in_sale');
    expect(orderSegment({ status: 'accepted' })).toBe('in_sale');
    expect(orderSegment({ status: 'pending', confirmed_at: '2026-11-13T10:00:00Z' })).toBe('in_sale');
  });
  it('puts cancelled and checked-out orders in Closed', () => {
    expect(orderSegment({ status: 'cancelled' })).toBe('closed');
    expect(orderSegment({ status: 'checked_out' })).toBe('closed');
  });
  it('reads an accepted order as Confirmed', () => {
    expect(isOrderConfirmed({ status: 'accepted' })).toBe(true);
    expect(isOrderConfirmed({ status: 'pending' })).toBe(false);
    expect(isOrderConfirmed({ status: 'pending', confirmed_at: '2026-11-13T10:00:00Z' })).toBe(true);
  });
});
