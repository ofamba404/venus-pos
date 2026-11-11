import { describe, expect, it } from 'vitest';
import { formatUGX, formatCompact, clientInitials } from '../../src/domain/format';

describe('formatUGX', () => {
  it('formats with thousands separators and no decimals', () => {
    expect(formatUGX(12500)).toBe('UGX 12,500');
    expect(formatUGX(0)).toBe('UGX 0');
  });
});

describe('formatCompact', () => {
  it('uses k and M suffixes', () => {
    expect(formatCompact(1500)).toBe('1.5k');
    expect(formatCompact(2_000_000)).toBe('2M');
  });
});

describe('clientInitials', () => {
  it('takes first letters', () => {
    expect(clientInitials('Amina N.')).toBe('AN');
    expect(clientInitials('')).toBe('?');
  });
});
