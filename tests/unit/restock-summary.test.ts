import { describe, expect, it } from 'vitest';
import { daysLeftLabel, restockSummary } from '../../src/domain/restock-summary';
import { restockPlan } from '../../src/domain/decisions-book';

const NOW = new Date(2026, 10, 12, 12);
const sale = (flavour: string, qty: number, daysAgo: number) => ({
  created_at: new Date(2026, 10, 12 - daysAgo, 10).toISOString(),
  items: [{ breakdown: { [flavour]: qty } }],
});

describe('restock summary', () => {
  it('says nothing to restock when no flavour will run out inside the cycle', () => {
    const plan = restockPlan([sale('mint', 14, 3)], { mint: 40, melon: 10, grape: 10, blueberry: 10, watermelon: 10, coconut: 10, strawberry: 10, classic: 10 }, NOW);
    const s = restockSummary(plan);
    expect(s.headline).toBe('Nothing to restock this cycle');
    expect(s.order).toEqual([]);
    expect(s.fine.length).toBeGreaterThanOrEqual(8);
    expect(s.fineLine).toBe(`${s.fine.length} flavours fine for 2+ weeks`);
  });

  it('orders only the urgent flavours, with the order quantity and fewest days first', () => {
    const plan = restockPlan(
      [sale('mint', 28, 5), sale('grape', 14, 5), sale('melon', 2, 5)],
      { mint: 6, grape: 20, melon: 30, blueberry: 5, watermelon: 5, coconut: 5, strawberry: 5, classic: 5 },
      NOW,
    );
    const s = restockSummary(plan);
    expect(s.headline).toBe('Restock 1 flavour');
    expect(s.order.map((r) => r.id)).toEqual(['mint']);
    // 28 sold in 14 days is 2 a day, so 6 on hand lasts 3 days, and 2 weeks needs 28 - 6.
    expect(s.order[0]).toMatchObject({ orderQty: 22 });
    expect(daysLeftLabel(s.order[0]!)).toBe('3 days left');
    expect(s.fine.map((r) => r.id)).not.toContain('mint');
  });

  it('pluralises, and keeps an out-of-stock flavour that is not selling out of the order list', () => {
    const plan = restockPlan(
      [sale('mint', 28, 2), sale('grape', 28, 2)],
      { mint: 0, grape: 2, melon: 0, blueberry: 9, watermelon: 9, coconut: 9, strawberry: 9, classic: 9 },
      NOW,
    );
    const s = restockSummary(plan);
    expect(s.headline).toBe('Restock 2 flavours');
    expect(s.idle.map((r) => r.id)).toContain('melon');
    expect(s.order.map((r) => r.id)).not.toContain('melon');
    expect(s.fine.map((r) => r.id)).not.toContain('melon');
  });

  it('survives no data, a single fine flavour, and labels days left', () => {
    expect(restockSummary(null).headline).toBe('Nothing to restock this cycle');
    expect(restockSummary(undefined).fineLine).toBe('');
    const one = restockSummary([{ id: 'mint', name: 'Mint', color: '#000', stock: 5, sold: 0, daysLeft: null, orderQty: 0, urgent: false, line: '', kind: 'joint' as const }]);
    expect(one.fineLine).toBe('1 flavour fine for 2+ weeks');
    expect(daysLeftLabel({ stock: 0, daysLeft: 0 })).toBe('Out of stock');
    expect(daysLeftLabel({ stock: 5, daysLeft: null })).toBe('No sales lately');
    expect(daysLeftLabel({ stock: 5, daysLeft: 0.4 })).toBe('Under a day left');
    expect(daysLeftLabel({ stock: 5, daysLeft: 1 })).toBe('1 day left');
    expect(daysLeftLabel({ stock: 5, daysLeft: 21 })).toBe('3 weeks left');
  });
});
