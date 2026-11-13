import { describe, expect, it } from 'vitest';
import { orderSegment } from '../../src/domain/order-segment';

describe('orderSegment', () => {
  it('puts pending and confirmed orders in Waiting', () => {
    expect(orderSegment({ id: 'a', status: 'pending' })).toBe('waiting');
    expect(orderSegment({ id: 'a', status: 'confirmed' })).toBe('waiting');
  });
  it('puts accepted orders In sale', () => {
    expect(orderSegment({ id: 'a', status: 'accepted' })).toBe('in_sale');
  });
  it('keeps a confirmed order that is loaded into the sale In sale', () => {
    expect(orderSegment({ id: 'a', status: 'confirmed' }, 'a')).toBe('in_sale');
    expect(orderSegment({ id: 'b', status: 'confirmed' }, 'a')).toBe('waiting');
  });
  it('unlinking sends it back to Waiting', () => {
    expect(orderSegment({ id: 'a', status: 'confirmed' }, '')).toBe('waiting');
  });
  it('a closed order stays Closed even if it is the loaded one', () => {
    expect(orderSegment({ id: 'a', status: 'cancelled' }, 'a')).toBe('closed');
    expect(orderSegment({ id: 'a', status: 'checked_out' }, 'a')).toBe('closed');
  });
});
