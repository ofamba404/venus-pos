import { describe, expect, it } from 'vitest';
import { orderSegment } from '../../src/domain/order-segment';
import { isOrderConfirmed } from '../../src/features/orders/confirm-order';

describe('orderSegment', () => {
  it('puts pending and confirmed orders in Waiting', () => {
    expect(orderSegment({ status: 'pending' })).toBe('waiting');
    expect(orderSegment({ status: 'confirmed' })).toBe('waiting');
  });
  it('keeps an accepted order with no sale in Waiting (there is no In sale tab)', () => {
    expect(orderSegment({ status: 'accepted' })).toBe('waiting');
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
