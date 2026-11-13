import { describe, expect, it } from 'vitest';
import {
  partnerConfirmText,
  partnerFailureMessage,
  partnerSendLabel,
  partnerSendPlan,
  settledCutsFor,
} from '../../src/domain/partner-send';
import { partialSendCount, type PartnerUnit } from '../../src/domain/partner';

function units(count: number): PartnerUnit[] {
  return Array.from({ length: count }, () => ({ revenue: 8000, ownerSplit: 2000, partnerDue: 6000 }));
}

describe('partial cookie partner send', () => {
  it('partialSendCount offers the open cookies only when no full batch waits', () => {
    expect(partialSendCount(6)).toBe(6);
    expect(partialSendCount(0)).toBe(0);
    expect(partialSendCount(25)).toBe(0);
    expect(partialSendCount(6, 25, 25)).toBe(0);
  });

  it('offers a partial for a part-filled batch, with its money', () => {
    const plan = partnerSendPlan(units(31), 25, [25])!;
    expect(plan).toMatchObject({ kind: 'partial', count: 6, index: 2, queued: 0 });
    expect(plan.batch).toMatchObject({ cookieCount: 6, partnerDue: 36000, ownerSplit: 12000, complete: false });
    expect(partnerSendLabel(plan)).toBe('Send part batch · 6 cookies');
    expect(partnerConfirmText(plan)).toContain('6 cookies');
    expect(partnerConfirmText(plan)).toContain('part batch (6 of 25)');
  });

  it('offers the full batch when one is waiting, and counts the queued ones', () => {
    const plan = partnerSendPlan(units(25 + 25 + 25 + 4), 25, [25])!;
    expect(plan).toMatchObject({ kind: 'ready', count: 25, index: 2, queued: 1 });
    expect(partnerSendLabel(plan)).toBe('Send batch 2 · 25 cookies');
    expect(partnerConfirmText(plan)).toContain('1 more full batch stay queued');
  });

  it('never offers a partial while a full batch is waiting, and never 0 cookies', () => {
    expect(partnerSendPlan(units(30), 0, [])!.kind).toBe('ready');
    expect(partnerSendPlan(units(25), 25, [25])).toBeNull();
    expect(partnerSendPlan(units(0), 0, [])).toBeNull();
    expect(partnerSendPlan(null, 0, [])).toBeNull();
  });

  it('numbers the next batch after a partial in the history', () => {
    // 25 + a partial of 6 are settled. The next batch is number 3.
    const plan = partnerSendPlan(units(40), 31, [25, 6])!;
    expect(plan).toMatchObject({ kind: 'partial', count: 9, index: 3 });
  });

  it('cuts: trusts a list that adds up, else rebuilds full batches plus a remainder', () => {
    expect(settledCutsFor(31, [25, 6])).toEqual([25, 6]);
    expect(settledCutsFor(31, [25, 5])).toEqual([25, 6]);
    expect(settledCutsFor(50, null)).toEqual([25, 25]);
    expect(settledCutsFor(0, [])).toEqual([]);
  });

  it('says why a send failed, in v1 words', () => {
    expect(partnerFailureMessage('auth')).toMatch(/Not signed in/);
    expect(partnerFailureMessage('stale')).toMatch(/Another device/);
    expect(partnerFailureMessage('http', 500)).toMatch(/Server error \(500\)/);
    expect(partnerFailureMessage('nothing')).toMatch(/Nothing to send/);
    expect(partnerFailureMessage('offline')).toMatch(/Could not reach the server/);
  });
});
