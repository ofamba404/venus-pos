/** One low/out toast per category per Kampala day (`venus.notif.stock.v1`). */
import { stockCrossing } from './stock-state';
import { kampalaDateKey } from './schedule-notify';

export function stockNotifyDecision(
  categoryId: string,
  prev: number,
  next: number,
  fired: Record<string, string> | null | undefined,
  now = new Date(),
): { toast: '' | 'low' | 'out'; fired: Record<string, string> } {
  const book = { ...(fired || {}) };
  const cross = stockCrossing(categoryId, prev, next);
  const day = kampalaDateKey(now);
  const kind = cross.crossedOut ? 'out' : cross.crossedLow ? 'low' : '';
  if (!kind) return { toast: '', fired: book };
  const key = `${kind}:${categoryId}`;
  if (book[key] === day) return { toast: '', fired: book };
  book[key] = day;
  return { toast: kind, fired: book };
}
