import type { CartLine } from './cart';
import { lineCount } from './line-count';

/** One line on the sale success summary: the name, how many, and what it came to. */
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

/** Delivery fee when this sale had delivery and a fee was set (including 0). Null when it did not. */
export function saleFee(delivery: boolean, raw: string | number | null | undefined): number | null {
  if (!delivery) return null;
  const fee = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(fee) || fee < 0) return null;
  return Math.round(fee);
}
