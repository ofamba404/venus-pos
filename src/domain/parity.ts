/** Pure helpers for parity rows that are not a single legacy function. */

export function selectionOverStock(
  rule: string,
  selection: Record<string, number>,
  sellable: Record<string, number>,
  opts: { categoryId?: string; fixedFlavor?: string } = {},
): boolean {
  if (rule === 'single_qty') {
    const id = opts.categoryId || '';
    return (selection.qty || 0) > (sellable[id] || 0);
  }
  if (rule === 'choose_variety') {
    const fixed = opts.fixedFlavor || 'classic';
    if ((sellable[fixed] || 0) < 1) return true;
  }
  return Object.entries(selection).some(([id, qty]) => {
    if (id === 'qty' || id === '_unitPrice' || qty <= 0) return false;
    return qty > (sellable[id] || 0);
  });
}

export function clientOwesLabel(owed: number): string {
  if (!(owed > 0)) return '';
  return `owes UGX ${Math.round(owed).toLocaleString('en-UG')}`;
}

export function stockGlance(levels: Array<'ok' | 'low' | 'out'>): { low: number; out: number; ok: number } {
  return levels.reduce(
    (acc, level) => {
      acc[level] += 1;
      return acc;
    },
    { low: 0, out: 0, ok: 0 },
  );
}

/** Window a long list. At least the viewport rows, plus a small overscan. */
export function virtualWindow<T>(items: T[], scrollTop: number, viewportPx: number, rowPx: number) {
  const row = Math.max(1, rowPx);
  const start = Math.max(0, Math.floor(scrollTop / row) - 2);
  const count = Math.ceil(viewportPx / row) + 4;
  return {
    start,
    items: items.slice(start, start + count),
    padPx: start * row,
  };
}

const PAINT_MS = 90_000;

export function readPaint<T>(raw: string | null, now: number): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { ts?: number; data?: T };
    if (!parsed || typeof parsed.ts !== 'number') return null;
    if (now - parsed.ts > PAINT_MS) return null;
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

export function writePaint<T>(data: T, now: number): string {
  return JSON.stringify({ ts: now, data });
}

export function readStoredId(raw: string | null, allowed: readonly string[], fallback: string): string {
  if (raw && allowed.includes(raw)) return raw;
  return fallback;
}

export function cancelledOrderBanner(status: string | null | undefined): string {
  if (status === 'cancelled') return 'This store order was cancelled.';
  return '';
}

export const INSTALL_STEPS = [
  'Android: open the browser menu and choose Install app.',
  'iPhone: tap Share, then Add to Home Screen.',
] as const;

export function clientNamesText(names: Array<string | null | undefined>): string {
  return names.map((name) => String(name || '').trim()).filter(Boolean).join('\n');
}

export type DebugEntry = { t: number; message: string };

export function pushDebug(log: DebugEntry[], message: string, now = Date.now()): DebugEntry[] {
  return [...log, { t: now, message: String(message || '') }].slice(-50);
}

export function debugLogText(log: DebugEntry[]): string {
  return log.map((row) => `${new Date(row.t).toISOString()} ${row.message}`).join('\n');
}

export function successCopy(opts: { queued?: boolean; credit?: boolean; savingDelivery?: boolean }): string {
  if (opts.queued) return 'Saved on this phone. It will sync when the signal returns.';
  if (opts.savingDelivery) return 'Saving delivery…';
  if (opts.credit) return 'Recorded on credit';
  return 'Sale recorded';
}
