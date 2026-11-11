import { describe, expect, it } from 'vitest';
import { contrastInk, relativeLuminance } from '../../src/domain/luminance';

describe('luminance', () => {
  it('picks ink on light fills and paper on dark', () => {
    expect(contrastInk('#ffffff')).toBe('ink');
    expect(contrastInk('#FFFFA5')).toBe('ink');
    expect(contrastInk('#5c2e1f')).toBe('paper');
    expect(contrastInk('#212121')).toBe('paper');
  });

  it('relativeLuminance is within 0..1', () => {
    expect(relativeLuminance('#000')).toBeGreaterThanOrEqual(0);
    expect(relativeLuminance('#fff')).toBeLessThanOrEqual(1);
  });
});
