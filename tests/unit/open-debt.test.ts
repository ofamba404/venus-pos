import { describe, expect, it } from 'vitest';
import { openDebtForClientName } from '../../src/domain/credit';

describe('openDebtForClientName', () => {
  const clients = [
    { id: 'a', name: 'Client With Debt' },
    { id: 'b', name: 'Test Client A' },
  ];

  it('sums uncleared credit for every row with that name', () => {
    const owed = openDebtForClientName('client with debt', clients, [
      { client_id: 'a', is_credit: true, credit_cleared: false, total_ugx: 15000, amount_paid_ugx: 0 },
      { client_id: 'a', is_credit: true, credit_cleared: true, total_ugx: 8000 },
      { client_id: 'b', is_credit: true, credit_cleared: false, total_ugx: 26000 },
    ]);
    expect(owed).toBe(15000);
  });

  it('is zero when the name is new', () => {
    expect(openDebtForClientName('Brand New Walk-in', clients, [])).toBe(0);
  });
});
