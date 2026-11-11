import { describe, expect, it } from 'vitest';
import { groupSalesByDay, mondayOfWeek, partitionThisWeek } from '../../src/domain/history-groups';

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
