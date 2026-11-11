/**
 * Dual-run: legacy fulfillment pure helpers vs domain/hours.
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
  toHHmm,
  isBusyActive,
  isWithinOpenHours,
  nextOpenAt,
  earliestAvailableAt,
  isUnavailableAt,
} from '../../legacy/js/fulfillment.js';
import * as next from '../../src/domain/hours.ts';

describe('hours dual-run', () => {
  it('matches toHHmm', () => {
    for (const v of ['7:00', '07:00:00', '22:30', '', null, 'nope']) {
      expect(next.toHHmm(v)).toBe(toHHmm(v));
    }
  });

  it('matches open-hours and busy checks', () => {
    const status = { openTime: '07:00', closeTime: '22:00', busyUntil: null, busyFor: 'both' };
    const noon = new Date('2026-11-12T12:00:00');
    const late = new Date('2026-11-12T23:00:00');
    expect(next.isWithinOpenHours(noon, status)).toBe(isWithinOpenHours(noon, status));
    expect(next.isWithinOpenHours(late, status)).toBe(isWithinOpenHours(late, status));

    const busy = { ...status, busyUntil: '2026-11-12T15:00:00.000Z' };
    const now = new Date('2026-11-12T14:00:00.000Z');
    expect(next.isBusyActive(busy, now)).toBe(isBusyActive(busy, now));
    expect(next.isUnavailableAt('2026-11-12T14:30:00.000Z', { status: busy, now })).toBe(
      isUnavailableAt('2026-11-12T14:30:00.000Z', { status: busy, now }),
    );
  });

  it('matches nextOpenAt / earliestAvailableAt', () => {
    const status = { openTime: '07:00', closeTime: '22:00', busyFor: 'both' };
    const closed = new Date('2026-11-12T23:30:00');
    expect(next.nextOpenAt(closed, status).getTime()).toBe(nextOpenAt(closed, status).getTime());
    expect(next.earliestAvailableAt(closed, { status }).getTime()).toBe(
      earliestAvailableAt(closed, { status }).getTime(),
    );
  });
});
