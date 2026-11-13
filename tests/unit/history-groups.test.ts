import { describe, expect, it } from 'vitest';
import {
  dayLabel,
  defaultOpenDay,
  groupDaysByWeek,
  groupSalesByDay,
  mondayOfWeek,
  partitionThisWeek,
  salesCount,
} from '../../src/domain/history-groups';

describe('history-groups', () => {
  it('groups sales by local day and sorts newest first', () => {
    const groups = groupSalesByDay([
      { id: '1', created_at: '2026-11-12T10:00:00', total_ugx: 8000 },
      { id: '2', created_at: '2026-11-12T18:00:00', total_ugx: 15000 },
      { id: '3', created_at: '2026-11-11T09:00:00', total_ugx: 5000 },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.count).toBe(2);
    expect(groups[0]!.total).toBe(23000);
    expect(groups[0]!.sales[0]!.id).toBe('2');
  });

  it('partitions current week from older days', () => {
    const now = new Date('2026-11-12T12:00:00');
    const mon = mondayOfWeek(now);
    expect(mon.getDay()).toBe(1);
    const { thisWeek, older } = partitionThisWeek(
      [
        { id: 'a', created_at: now.toISOString(), total_ugx: 1 },
        { id: 'b', created_at: '2026-10-01T12:00:00', total_ugx: 2 },
      ],
      now,
    );
    expect(thisWeek.some((g) => g.sales.some((s) => s.id === 'a'))).toBe(true);
    expect(older.some((g) => g.sales.some((s) => s.id === 'b'))).toBe(true);
  });
});

describe('history headings', () => {
  const now = new Date(2026, 10, 13, 12);
  const at = (d: number, h = 10) => ({ id: `s${d}-${h}`, created_at: new Date(2026, 10, d, h).toISOString(), total_ugx: 1000 });

  it('labels Today, Yesterday, then the dated day', () => {
    expect(dayLabel(new Date(2026, 10, 13), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 10, 12), now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 10, 10), now)).toMatch(/Tue,? 10 Nov/);
  });

  it('writes "1 sale" and "5 sales"', () => {
    expect(salesCount(1)).toBe('1 sale');
    expect(salesCount(5)).toBe('5 sales');
  });

  it('opens Today, or the latest day when nothing sold today, and nothing when empty', () => {
    expect(defaultOpenDay(groupSalesByDay([at(13), at(12)]), now)).toBe(groupSalesByDay([at(13)])[0]!.key);
    expect(defaultOpenDay(groupSalesByDay([at(11), at(9)]), now)).toBe(groupSalesByDay([at(11)])[0]!.key);
    expect(defaultOpenDay([], now)).toBe('');
  });

  it('gathers older days into weeks starting Monday, newest week first, with totals', () => {
    const weeks = groupDaysByWeek(groupSalesByDay([at(8), at(7), at(7, 12), at(2), at(1)]));
    expect(weeks).toHaveLength(2);
    expect(weeks[0]!.monday.getDate()).toBe(2);
    expect(weeks[0]!.count).toBe(4);
    expect(weeks[0]!.total).toBe(4000);
    expect(weeks[0]!.days).toHaveLength(3);
    expect(weeks[1]!.monday.getDate()).toBe(26);
    expect(weeks[1]!.count).toBe(1);
  });
});
