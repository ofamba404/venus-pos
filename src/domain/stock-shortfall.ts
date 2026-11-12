/** Cart lines that need more than the system shelf. Port of `cartStockShortfalls` in `legacy/js/orders.js`. */
import { CAT_MAP, normalizeInventoryBreakdown } from './catalog';

export type StockShortfall = {
  id: string;
  name: string;
  need: number;
  have: number;
  short: number;
};

function stockCatLabel(id: string): string {
  const cat = CAT_MAP[id];
  if (!cat) return id;
  if (id.startsWith('spliff')) return `Bangis${cat.sub ? ` ${cat.sub}` : ''}`;
  return cat.name || id;
}

export function cartStockShortfalls(
  lines: Array<{ breakdown?: Record<string, unknown> | null }> | null | undefined,
  shelf: Record<string, number> | null | undefined,
  known: boolean,
): StockShortfall[] {
  if (!known || !shelf) return [];
  const need: Record<string, number> = {};
  for (const line of lines || []) {
    Object.entries(normalizeInventoryBreakdown(line?.breakdown)).forEach(([id, qty]) => {
      need[id] = (need[id] || 0) + qty;
    });
  }
  return Object.entries(need)
    .filter(([id, n]) => Object.prototype.hasOwnProperty.call(shelf, id) && n > Math.max(0, Number(shelf[id]) || 0))
    .map(([id, n]) => {
      const have = Math.max(0, Number(shelf[id]) || 0);
      return { id, name: stockCatLabel(id), need: n, have, short: n - have };
    });
}

export function sellAnywayMessage(shortfalls: StockShortfall[]): string {
  const lines = shortfalls
    .map((row) => `• ${row.name}: selling ${row.need}, system has ${row.have} (short ${row.short})`)
    .join('\n');
  return `Sell anyway?\n\nNot enough stock in the system:\n${lines}\n\nStock will go to 0 and the shortfall is logged under your name.`;
}
