/**
 * Day buckets inside legacy buildOrderHistoryTree vs domain/history-groups.
 * The legacy module renders DOM later in the file; this test only reads the tree.
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildOrderHistoryTree } from '../../legacy/js/order-history.js';
import { groupSalesByDay } from '../../src/domain/history-groups.ts';

type Day = { dateObj: Date; total: number; count: number };

function flattenDays(tree: {
  thisWeekDays: Day[];
  recentWeeks: { days: Day[] }[];
  months: { days: Day[] }[];
}): Day[] {
  return [
    ...tree.thisWeekDays,
    ...tree.recentWeeks.flatMap((w) => w.days),
    ...tree.months.flatMap((m) => m.days),
  ];
}

describe('history-groups dual-run', () => {
  it('matches day totals inside the legacy tree (2000 runs)', () => {
    const now = new Date('2026-11-10T10:30:00+03:00');
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            created_at: fc
              .integer({ min: Date.parse('2025-06-01T00:00:00Z'), max: Date.parse('2026-11-10T07:30:00Z') })
              .map((n) => new Date(n).toISOString()),
            total_ugx: fc.integer({ min: 0, max: 200000 }),
          }),
          { maxLength: 24 },
        ),
        (sales) => {
          const tree = buildOrderHistoryTree(sales, now);
          const legacy = flattenDays(tree)
            .map((d) => ({
              key: `${d.dateObj.getFullYear()}-${d.dateObj.getMonth()}-${d.dateObj.getDate()}`,
              total: d.total,
              count: d.count,
            }))
            .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
          const next = groupSalesByDay(sales)
            .map((g) => ({ key: g.key, total: g.total, count: g.count }))
            .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
          expect(next).toEqual(legacy);
        },
      ),
      { numRuns: 2000 },
    );
  }, 20_000);
});
