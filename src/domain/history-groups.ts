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

export type WeekGroup = {
  key: string;
  monday: Date;
  days: DayGroup[];
  total: number;
  count: number;
};

/** "Today", "Yesterday", or "Wed 11 Nov". */
export function dayLabel(date: Date, now: Date = new Date()): string {
  const diff = Math.round((startOfLocalDay(now).getTime() - startOfLocalDay(date).getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "1 sale" / "5 sales". The bare count was ambiguous next to a date and an amount. */
export function salesCount(n: number): string {
  return `${n} sale${n === 1 ? '' : 's'}`;
}

/** Older days gathered into one group per week (Monday start), newest week first. */
export function groupDaysByWeek(days: DayGroup[]): WeekGroup[] {
  const weeks = new Map<string, WeekGroup>();
  for (const day of days) {
    const monday = mondayOfWeek(day.dateObj);
    const key = dayKey(monday);
    let week = weeks.get(key);
    if (!week) {
      week = { key, monday, days: [], total: 0, count: 0 };
      weeks.set(key, week);
    }
    week.days.push(day);
    week.total += day.total;
    week.count += day.count;
  }
  return [...weeks.values()].sort((a, b) => b.monday.getTime() - a.monday.getTime());
}

/**
 * Which groups start open: Today, or the latest day when nothing sold today. Everything older starts closed.
 * Only one day opens by default, so a long history is a short list of headings.
 */
export function defaultOpenDay(days: DayGroup[], now: Date = new Date()): string {
  if (!days.length) return '';
  const today = dayKey(startOfLocalDay(now));
  return days.some((d) => d.key === today) ? today : days[0]!.key;
}
