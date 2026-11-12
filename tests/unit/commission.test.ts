import { describe, expect, it, vi } from 'vitest';
import { commissionLedger } from '../../src/domain/commission';
import { profitPicture, type DecisionSale } from '../../src/domain/decisions';
import { ECONOMICS } from '../../src/domain/economics';

const sale: DecisionSale = {
  id: 's1',
  created_at: '2026-11-12T12:00:00.000Z',
  total_ugx: 25000,
  amount_paid_ugx: 25000,
  is_credit: false,
  items: [{ product_id: 'commander', product_name: 'Commander Pack', line_total: 25000, breakdown: { mint: 5 } }],
} as unknown as DecisionSale;

describe('commission ledger', () => {
  const earned = profitPicture([sale], null).helper;

  it('uses the 40% estimate from economics', () => {
    expect(ECONOMICS.helperShare).toBe(0.4);
    const ledger = commissionLedger([sale], null, []);
    expect(ledger.share).toBe(0.4);
    expect(ledger.earned).toBe(earned);
    expect(ledger.earned).toBeGreaterThan(0);
    expect(ledger.owed).toBe(earned);
    expect(ledger.paid).toBe(0);
    expect(ledger.lastPaid).toBeNull();
  });

  it('subtracts what has been paid and reports the last payout', () => {
    const ledger = commissionLedger([sale], null, [
      { amount_ugx: 1000, paid_at: '2026-11-01T00:00:00Z' },
      { amount_ugx: 500, paid_at: '2026-11-08T00:00:00Z' },
      { amount_ugx: 0, paid_at: '2026-11-11T00:00:00Z' },
      { amount_ugx: null },
    ]);
    expect(ledger.paid).toBe(1500);
    expect(ledger.owed).toBe(earned - 1500);
    expect(ledger.lastPaid).toEqual({ amount: 500, at: '2026-11-08T00:00:00Z' });
    expect(ledger.ahead).toBe(0);
  });

  it('never goes below zero when paid runs ahead', () => {
    const ledger = commissionLedger([sale], null, [{ amount_ugx: earned + 700, paid_at: '2026-11-08T00:00:00Z' }]);
    expect(ledger.owed).toBe(0);
    expect(ledger.ahead).toBe(700);
  });

  it('handles no data and a different share', () => {
    expect(commissionLedger(null, null, null)).toMatchObject({ earned: 0, paid: 0, owed: 0, ahead: 0 });
    expect(commissionLedger([sale], null, [], 0.2).earned).toBe(profitPicture([sale], null, { helperShare: 0.2 }).helper);
    expect(commissionLedger([sale], null, [{ amount_ugx: 5 }]).lastPaid).toEqual({ amount: 5, at: '' });
  });
});

describe('staff settlements fetch', () => {
  it('reads the rows, and gives null when it cannot', async () => {
    vi.resetModules();
    const sbFetch = vi.fn();
    vi.doMock('../../src/data/api', () => ({ sbFetch }));
    const { fetchStaffSettlements } = await import('../../src/data/commission');
    sbFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ id: 'a', amount_ugx: 5 }] });
    expect(await fetchStaffSettlements()).toEqual([{ id: 'a', amount_ugx: 5 }]);
    expect(String(sbFetch.mock.calls[0]![0])).toContain('staff_settlements');
    sbFetch.mockResolvedValueOnce({ ok: false });
    expect(await fetchStaffSettlements()).toBeNull();
    sbFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    expect(await fetchStaffSettlements()).toBeNull();
    sbFetch.mockRejectedValueOnce(new Error('offline'));
    expect(await fetchStaffSettlements()).toBeNull();
    vi.doUnmock('../../src/data/api');
  });
});
