import { describe, expect, it } from 'vitest';
import { computeTodayStats, countLabel, salesToday, todayUnitMeta } from '../../src/domain/today';

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

  it('pluralises sold units', () => {
    expect(countLabel(1, 'joint')).toBe('1 joint');
    expect(countLabel(2, 'joint')).toBe('2 joints');
    expect(countLabel(1, 'cookie')).toBe('1 cookie');
    expect(countLabel(0, 'cookie')).toBe('0 cookies');
    expect(todayUnitMeta({ revenue: 8000, salesCount: 1, joints: 1, cookies: 0 })).toBe('1 sold · 1 joint');
    expect(todayUnitMeta({ revenue: 0, salesCount: 3, joints: 2, cookies: 1 })).toBe('3 sold · 2 joints · 1 cookie');
  });
});
