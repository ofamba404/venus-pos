import { afterEach, describe, expect, it } from 'vitest';
import { deliveryModel, deliveryModelReady, fallbackFeeForKm, predictFeeForDest } from '../../src/data/delivery-model';

describe('predictFeeForDest', () => {
  afterEach(() => {
    deliveryModel.value = null;
    deliveryModelReady.value = false;
  });

  it('still returns a rounded estimate when there is no fitted deliveries model', () => {
    deliveryModel.value = null;
    deliveryModelReady.value = true;
    const quote = predictFeeForDest({ lat: 0.3328, lng: 32.5978 });
    expect(quote.km).toBeGreaterThan(0);
    expect(quote.predicted).toBeGreaterThanOrEqual(3000);
    expect(quote.predicted! % 500).toBe(0);
    const fallback = fallbackFeeForKm(quote.km, quote.durationMin);
    expect(quote.predicted).toBe(fallback.predicted);
  });
});
