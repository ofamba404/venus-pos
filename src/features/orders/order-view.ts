import type { StoreOrderRow } from '../../data/entities';

/** One storefront item the way the cards and the sheet read it. Storefront orders spell products and flavours their own way (cookie-duet, flavors: [...]). */
export function orderLine(raw: unknown): { name: string; productId?: string; breakdown?: Record<string, unknown> } {
  if (!raw || typeof raw !== 'object') return { name: '' };
  const item = raw as {
    product_id?: string;
    store_product_id?: string;
    product_name?: string;
    name?: string;
    breakdown?: Record<string, unknown>;
    flavors?: string[];
  };
  const productId = String(item.product_id || item.store_product_id || '')
    .replace(/-/g, '_')
    .replace(/_pack$/, '');
  let breakdown = item.breakdown;
  if ((!breakdown || !Object.keys(breakdown).length) && Array.isArray(item.flavors)) {
    breakdown = {};
    for (const flavor of item.flavors) {
      const key = String(flavor).replace(/-/g, '_');
      const id = productId.startsWith('cookie') && !key.startsWith('cookie') ? `cookie_${key}` : key;
      breakdown[id] = (Number(breakdown[id]) || 0) + 1;
    }
  }
  return { name: String(item.product_name || item.name || '').trim(), productId, breakdown };
}

/** Items only. The delivery fee is its own field on the order. */
export function orderTotal(o: StoreOrderRow): number {
  const items = Array.isArray(o.items) ? o.items : [];
  return items.reduce<number>((sum, it) => {
    const row = it as { line_total?: number; unit_price_ugx?: number; quantity?: number; is_reward?: boolean };
    if (row.is_reward) return sum;
    const line = Math.round(Number(row.line_total) || 0);
    if (line) return sum + line;
    return sum + Math.round((Number(row.unit_price_ugx) || 0) * (Number(row.quantity) || 1));
  }, 0);
}
