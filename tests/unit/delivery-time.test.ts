import { describe, expect, it } from 'vitest';
import { deliveryTimePill } from '../../src/domain/delivery-time';

describe('deliveryTimePill', () => {
  it('returns Right now for ASAP', () => {
    expect(deliveryTimePill({ mode: 'asap' })).toBe('Right now');
    expect(deliveryTimePill({ label: 'ASAP' })).toBe('Right now');
    expect(deliveryTimePill({ label: 'Right now' })).toBe('Right now');
  });
  it('returns the clock time in Africa/Kampala', () => {
    expect(deliveryTimePill({ deliverAt: '2026-11-10T13:30:00.000Z' })).toBe('4:30 PM');
  });
  it('is empty when there is no delivery', () => {
    expect(deliveryTimePill(null)).toBe('');
    expect(deliveryTimePill({})).toBe('');
  });
});
