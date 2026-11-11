/**
 * Dual-run: legacy `fmtUGX` / helpers vs v2 `domain/format`.
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { fmtUGX, fmtCompact, clientInitials, escapeHtml } from '../../js/utils.js';
import {
  formatUGX,
  formatCompact,
  clientInitials as v2Initials,
  escapeHtml as v2Escape,
} from '../../src/domain/format.ts';

describe('format dual-run', () => {
  it('matches hand-picked UGX cases', () => {
    for (const n of [0, 1, 999, 1000, 12500, 1_000_000, 1_000_000.4, -50]) {
      expect(formatUGX(n)).toBe(fmtUGX(n));
    }
  });

  it('matches fmtUGX for random numbers (2000 runs)', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e9, max: 1e9, noNaN: true }), (n) => {
        expect(formatUGX(n)).toBe(fmtUGX(n));
      }),
      { numRuns: 2000 },
    );
  });

  it('matches fmtCompact', () => {
    for (const n of [0, 999, 1000, 1500, 1_000_000, 2_500_000]) {
      expect(formatCompact(n)).toBe(fmtCompact(n));
    }
  });

  it('matches clientInitials', () => {
    for (const name of ['', 'Amina', 'Jean Marie', '  ', '🎉 Party', 'Émile']) {
      expect(v2Initials(name)).toBe(clientInitials(name));
    }
  });

  it('matches escapeHtml', () => {
    for (const s of ['', 'a<b>', 'a&b', '"hi"', null, 12]) {
      expect(v2Escape(s)).toBe(escapeHtml(s));
    }
  });
});
