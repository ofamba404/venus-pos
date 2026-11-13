import { describe, expect, it, vi } from 'vitest';
import { collectedIn, creditBook, owedAgeLabel } from '../../src/domain/credit-book';
import { CHART_RANGES } from '../../src/domain/analytics/periods';

vi.mock('../../src/data/writes/sales', () => ({ patchSale: vi.fn(async () => ({ ok: true, status: 200 })) }));
vi.mock('../../src/data/writes/credit', () => ({ postCreditPayment: vi.fn(async () => ({ ok: true })) }));

const NOW = new Date(2026, 10, 12, 12);

describe('credit book edges', () => {
  it('treats a missing date as today and ignores junk amounts', () => {
    const book = creditBook(
      [
        { id: 'a', client_id: 'c1', is_credit: true, total_ugx: 4000, amount_paid_ugx: -5 },
        { id: 'b', client_id: 'c1', is_credit: true, total_ugx: 'x' as never, amount_paid_ugx: 0 },
      ],
      [{ id: 'c1', name: null, phone: '0772000111' }],
      NOW,
    );
    expect(book.owed).toBe(4000);
    expect(book.people[0]).toMatchObject({ name: 'Client', oldestDays: 0, ageLabel: 'owed today' });
    expect(owedAgeLabel(Number.NaN)).toBe('owed today');
  });

  it('collected ignores negative and non-numeric amounts and a missing date', () => {
    const r = CHART_RANGES.find((x) => x.id === 'all')!;
    expect(
      collectedIn([{ amount_ugx: -4, created_at: '2026-11-10' }, { amount_ugx: 'z', created_at: '2026-11-10' }, { amount_ugx: 5 }], r, NOW),
    ).toBe(0);
  });
});

describe('settleCredit', () => {
  it('pays oldest first, posts one payment row with method cash, and reports errors plainly', async () => {
    const { settleCredit, SETTLE_DEFAULT_METHOD } = await import('../../src/data/credit-settle');
    const sales = await import('../../src/data/writes/sales');
    const credit = await import('../../src/data/writes/credit');
    const open = [
      { id: 's1', client_id: 'c1', is_credit: true, total_ugx: 5000, amount_paid_ugx: 0, created_at: '2026-11-01' },
      { id: 's2', client_id: 'c1', is_credit: true, total_ugx: 5000, amount_paid_ugx: 0, created_at: '2026-11-05' },
    ];
    expect(await settleCredit({ openSales: open, clientId: 'c1', amount: 7000, note: ' part ' })).toEqual({ ok: true, paid: 7000 });
    expect(sales.patchSale).toHaveBeenCalledTimes(2);
    expect(credit.postCreditPayment).toHaveBeenCalledWith({ client_id: 'c1', amount_ugx: 7000, method: SETTLE_DEFAULT_METHOD, note: 'part' });
    expect(await settleCredit({ openSales: open, amount: 99999999 })).toEqual({ ok: true, paid: 10000 });
    expect(await settleCredit({ openSales: open, clientId: 'c1', amount: 0 })).toEqual({ ok: false, error: 'Enter an amount' });
    expect(await settleCredit({ openSales: [], clientId: 'c1', amount: 10 })).toEqual({ ok: false, error: 'Nothing owed' });
    vi.mocked(sales.patchSale).mockResolvedValueOnce({ ok: false, status: 500 } as never);
    expect(await settleCredit({ openSales: open, clientId: 'c1', amount: 100 })).toEqual({ ok: false, error: 'Could not update sale (500)' });
    vi.mocked(sales.patchSale).mockRejectedValueOnce(new Error('boom'));
    expect(await settleCredit({ openSales: open, clientId: 'c1', amount: 100 })).toEqual({ ok: false, error: 'boom' });
    vi.mocked(sales.patchSale).mockRejectedValueOnce('weird');
    expect(await settleCredit({ openSales: open, clientId: 'c1', amount: 100 })).toEqual({ ok: false, error: 'Settle failed' });
  });
});
