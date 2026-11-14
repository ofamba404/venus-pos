import type { CartLine } from './cart';
import { lineCount } from './line-count';

/** How the sale was fulfilled. Walk-in is a counter sale, not a storefront pickup. */
export type SaleFulfilment = 'delivery' | 'pickup' | 'walk-in';

/** One line on the sale success summary: how many, the name, and flavour dots. */
export type SaleSummaryLine = {
  name: string;
  qty: number;
  total: number;
  productId?: string;
  breakdown?: Record<string, unknown>;
};

/** Cart lines in the compact form the success sheet draws. */
export function saleSummaryLines(lines: CartLine[]): SaleSummaryLine[] {
  return lines.map((line) => {
    const { qty } = lineCount(line);
    return {
      name: line.name,
      qty,
      total: line.isReward ? 0 : Math.round(Number(line.lineTotal) || 0),
      productId: line.productId,
      breakdown: line.breakdown,
    };
  });
}

export function saleFulfilmentLabel(kind: SaleFulfilment): string {
  if (kind === 'delivery') return 'Delivery';
  if (kind === 'pickup') return 'Pickup';
  return 'Walk-in';
}

/** A walk-in cart sale: Delivery only when a drop-off was actually set, Pickup when that was chosen, otherwise Walk-in. */
export function cartFulfilment(input: { deliveryEnabled: boolean; place?: string | null }): SaleFulfilment {
  if (input.deliveryEnabled === false) return 'pickup';
  if (String(input.place || '').trim()) return 'delivery';
  return 'walk-in';
}
