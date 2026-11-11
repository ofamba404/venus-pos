/** History day grouping — port of `legacy/js/order-history.js` day buckets. */

export type HistorySale = {
  id?: string;
  created_at?: string;
  total_ugx?: number;
};

export type DayGroup = {
  key: string;
  dateObj: Date;
  sales: HistorySale[];
  total: number;
  count: number;
};

function startOfLocalDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function mondayOfWeek(d: Date) {
  const x = startOfLocalDay(d);
  const day = x.getDay();
  const offset = day === 0 ? 6 : day - 1;
  x.setDate(x.getDate() - offset);
  return x;
}

export function groupSalesByDay(sales: HistorySale[] | null | undefined): DayGroup[] {
  const dayMap = new Map<string, { dateObj: Date; sales: HistorySale[] }>();
  (sales || []).forEach((s) => {
    const dateObj = startOfLocalDay(new Date(s.created_at || 0));
    const key = dayKey(dateObj);
    if (!dayMap.has(key)) dayMap.set(key, { dateObj, sales: [] });
    dayMap.get(key)!.sales.push(s);
  });

  const groups: DayGroup[] = [];
  for (const [key, group] of dayMap.entries()) {
    group.sales.sort(
      (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
    );
    groups.push({
      key,
      dateObj: group.dateObj,
      sales: group.sales,
      total: group.sales.reduce((sum, s) => sum + (Number(s.total_ugx) || 0), 0),
      count: group.sales.length,
    });
  }
  groups.sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime());
  return groups;
}

export function partitionThisWeek(
  sales: HistorySale[] | null | undefined,
  now: Date = new Date(),
): { thisWeek: DayGroup[]; older: DayGroup[] } {
  const groups = groupSalesByDay(sales);
  const weekStart = mondayOfWeek(now);
  const thisWeek: DayGroup[] = [];
  const older: DayGroup[] = [];
  for (const g of groups) {
    if (g.dateObj >= weekStart) thisWeek.push(g);
    else older.push(g);
  }
  return { thisWeek, older };
}
