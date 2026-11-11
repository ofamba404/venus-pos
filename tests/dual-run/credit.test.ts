/**
 * Dual-run: legacy credit.js vs domain/credit.
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import * as legacy from '../../legacy/js/credit.js';
import * as next from '../../src/domain/credit.ts';

const arbSale = fc.record({
  id: fc.uuid(),
  client_id: fc.option(fc.uuid(), { nil: null }),
  is_credit: fc.boolean(),
  credit_cleared: fc.boolean(),
  total_ugx: fc.integer({ min: 0, max: 200_000 }),
  amount_paid_ugx: fc.integer({ min: 0, max: 200_000 }),
  created_at: fc.constantFrom(
    '2026-01-01T00:00:00.000Z',
    '2026-06-01T00:00:00.000Z',
    '2026-11-01T00:00:00.000Z',
  ),
});

describe('credit dual-run', () => {
  it('matches FIFO allocations on hand-picked cases', () => {
    const sales = [
      {
        id: '1',
        client_id: 'c1',
        is_credit: true,
        credit_cleared: false,
        total_ugx: 10000,
        amount_paid_ugx: 0,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: '2',
        client_id: 'c1',
        is_credit: true,
        credit_cleared: false,
        total_ugx: 8000,
        amount_paid_ugx: 2000,
        created_at: '2026-02-01T00:00:00.000Z',
      },
    ];
    const a = next.allocatePaymentFifo(sales, 12000);
    const b = legacy.allocatePaymentFifo(sales, 12000);
    expect(a.map((x) => ({ id: x.sale.id, applyUgx: x.applyUgx, clears: x.clears }))).toEqual(
      b.map((x: { sale: { id: string }; applyUgx: number; clears: boolean }) => ({
        id: x.sale.id,
        applyUgx: x.applyUgx,
        clears: x.clears,
      })),
    );
  });

  it('matches balances and FIFO for random sales (2000 runs)', () => {
    fc.assert(
      fc.property(fc.array(arbSale, { maxLength: 8 }), fc.integer({ min: 0, max: 50_000 }), (sales, amount) => {
        expect(next.sumCreditOwed(sales)).toBe(legacy.sumCreditOwed(sales));
        const a = next.allocatePaymentFifo(sales, amount);
        const b = legacy.allocatePaymentFifo(sales, amount);
        expect(a.map((x) => [x.sale.id, x.applyUgx, x.newPaid, x.clears])).toEqual(
          b.map((x: { sale: { id: string }; applyUgx: number; newPaid: number; clears: boolean }) => [
            x.sale.id,
            x.applyUgx,
            x.newPaid,
            x.clears,
          ]),
        );
      }),
      { numRuns: 2000 },
    );
  });
});
