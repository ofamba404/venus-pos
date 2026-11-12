/**
 * Legacy snapshot of the hours-dial clock math.
 * v2 does not own this UI yet; Phase 0 only locks what v1 does.
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DIAL_MINUTE_STEP,
  dialPartsToDate,
  formatDialDayLabel,
  snapDialMinutes,
  toDialParts,
} from '../../legacy/js/hours-dial.js';

describe('hours dial legacy snapshot', () => {
  it('snaps minutes onto the 5-minute step (2000 runs)', () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date('2024-01-01T00:00:00Z'),
          max: new Date('2028-01-01T00:00:00Z'),
          noInvalidDate: true,
        }),
        (d) => {
          const snapped = snapDialMinutes(d);
          expect(snapped.getSeconds()).toBe(0);
          expect(snapped.getMilliseconds()).toBe(0);
          expect(snapped.getMinutes() % DIAL_MINUTE_STEP).toBe(0);
          // Minutes are rounded on their own, then seconds are cleared, so the
          // jump can be almost three minutes (for example 07:31 → 05:00).
          expect(Math.abs(snapped.getTime() - d.getTime())).toBeLessThan(180_000);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('keeps the chosen hour and am/pm when building a future dial time (2000 runs)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 11 }).map((step) => step * DIAL_MINUTE_STEP),
        fc.constantFrom('am', 'pm'),
        fc.date({
          min: new Date('2026-06-01T00:00:00'),
          max: new Date('2026-06-02T00:00:00'),
          noInvalidDate: true,
        }),
        (hour12, minute, ampm, now) => {
          const d = dialPartsToDate({ hour12, minute, ampm }, now);
          const parts = toDialParts(d);
          expect(parts.hour12).toBe(hour12);
          expect(parts.minute).toBe(minute);
          expect(parts.ampm).toBe(ampm);
          // A clock that lands exactly 30s ahead is kept. Anything sooner rolls a day.
          expect(d.getTime()).toBeGreaterThanOrEqual(now.getTime() + 30_000);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('labels the same civil day Today and the next day Tomorrow', () => {
    const now = new Date(2026, 10, 12, 15, 0, 0);
    expect(formatDialDayLabel(new Date(2026, 10, 12, 18, 0, 0), now)).toBe('Today');
    expect(formatDialDayLabel(new Date(2026, 10, 13, 9, 0, 0), now)).toBe('Tomorrow');
  });
});
