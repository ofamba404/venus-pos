import { describe, expect, it } from 'vitest';
import { BASE_ORIGIN, haversineKm, roadKmEstimate } from '../../src/domain/geo';

describe('geo', () => {
  it('haversine is ~0 for same point', () => {
    expect(haversineKm(BASE_ORIGIN, BASE_ORIGIN)).toBeCloseTo(0, 6);
  });

  it('estimates a short Kampala hop', () => {
    const dest = { lat: 0.3305576, lng: 32.5800566 };
    const km = haversineKm(BASE_ORIGIN, dest);
    expect(km).toBeGreaterThan(0.5);
    expect(km).toBeLessThan(5);
    expect(roadKmEstimate(km)).toBeGreaterThan(km);
  });
});
