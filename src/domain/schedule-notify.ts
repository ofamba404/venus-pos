/** Kampala wall-clock helpers for notification dedupe. Africa/Kampala is UTC+3. */

export const SCHEDULE_POLL_MS = 30_000;

export function kampalaDateKey(now = new Date()): string {
  const d = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function scheduleAlreadyFired(
  fired: Record<string, string> | null | undefined,
  id: string,
  now = new Date(),
): boolean {
  return Boolean(fired && fired[id] === kampalaDateKey(now));
}

export function markScheduleFired(
  fired: Record<string, string> | null | undefined,
  id: string,
  now = new Date(),
): Record<string, string> {
  return { ...(fired || {}), [id]: kampalaDateKey(now) };
}

export function kampalaMinuteOfDay(now = new Date()): number {
  const shifted = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

export type LocalSchedule = { id: string; startMin: number; endMin: number; title: string };

/** Local reminders while the register is open. Empty list fires nothing. */
export function tickLocalSchedules(
  schedules: LocalSchedule[],
  fired: Record<string, string> | null | undefined,
  enabled: boolean,
  now = new Date(),
): { fired: Record<string, string>; titles: string[] } {
  const book = { ...(fired || {}) };
  if (!enabled) return { fired: book, titles: [] };
  const minute = kampalaMinuteOfDay(now);
  const titles: string[] = [];
  for (const row of schedules) {
    if (minute < row.startMin || minute > row.endMin) continue;
    if (scheduleAlreadyFired(book, row.id, now)) continue;
    book[row.id] = kampalaDateKey(now);
    titles.push(row.title);
  }
  return { fired: book, titles };
}
