import { describe, expect, it } from 'vitest';
import { computeTodayStats, salesToday } from '../../src/domain/today';

describe('today stats', () => {
  const now = new Date('2026-11-12T12:00:00+03:00');

  it('filters to local calendar day', () => {
    const list = [
      {
        created_at: '2026-11-12T08:00:00+03:00',
        total_ugx: 8000,
        is_credit: false,
        items: [{ breakdown: { mint: 1 } }],
      },
      {
        created_at: '2026-11-11T23:00:00+03:00',
        total_ugx: 15000,
        is_credit: false,
        items: [{ breakdown: { mint: 2 } }],
      },
    ];
    expect(salesToday(list, now)).toHaveLength(1);
    const stats = computeTodayStats(list, now);
    expect(stats.salesCount).toBe(1);
    expect(stats.joints).toBe(1);
  });

  it('counts cookies separately from joints', () => {
    const stats = computeTodayStats(
      [
        {
          created_at: '2026-11-12T09:00:00+03:00',
          total_ugx: 15000,
          is_credit: false,
          credit_cleared: true,
          items: [
            {
              product_id: 'cookie_duet',
              breakdown: { cookie_mint: 1, cookie_chocolate: 1 },
              line_total: 15000,
            },
          ],
        },
      ],
      now,
    );
    expect(stats.cookies).toBe(2);
    expect(stats.joints).toBe(0);
  });
});
