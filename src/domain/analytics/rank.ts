/** Analytics aggregations ported from `legacy/js/analytics.js`. */

export function canonicalProductName(name: unknown): string {
  const n = String(name || '').trim();
  if (!n) return 'Unknown';
  if (/^plain(\s+joint)?$/i.test(n)) return 'Plain';
  return n;
}

export function topProductForSales(
  sales: Array<{ items?: Array<{ product_name?: string }> | null }> | null | undefined,
): { topProduct: string; topCount: number } {
  const productTotals: Record<string, number> = {};
  for (const sale of sales || []) {
    for (const item of sale.items || []) {
      const name = canonicalProductName(item.product_name);
      productTotals[name] = (productTotals[name] || 0) + 1;
    }
  }
  let topProduct = '—';
  let topCount = 0;
  for (const [name, count] of Object.entries(productTotals)) {
    if (count > topCount) {
      topCount = count;
      topProduct = name;
    }
  }
  return { topProduct, topCount };
}

export function revenueDelta(today: number, yesterday: number): { text: string; cls: 'neutral' | 'up' | 'down' } {
  if (yesterday === 0 && today === 0) return { text: 'Same as yesterday', cls: 'neutral' };
  if (yesterday === 0) return { text: 'First sales today', cls: 'up' };
  const pct = Math.round(((today - yesterday) / yesterday) * 100);
  if (pct === 0) return { text: 'Same as yesterday', cls: 'neutral' };
  if (pct > 0) return { text: `+${pct}% vs yesterday`, cls: 'up' };
  return { text: `${pct}% vs yesterday`, cls: 'down' };
}
