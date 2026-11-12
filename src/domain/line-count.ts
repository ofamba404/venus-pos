import { PRODUCTS } from './catalog';
import type { CartLine } from './cart';

export type LineCount = {
  /** How many of this line are being sold. A pack line is one pack. */
  qty: number;
  /** What is inside one: "8 joints", "2 cookies". Null for singles, where the quantity is the count. */
  contents: string | null;
};

/** Keeps the quantity apart from the contents, so a Variety Pack reads x1 with 8 joints, never a bare 8. */
export function lineCount(line: Pick<CartLine, 'productId' | 'breakdown' | 'quantity'>): LineCount {
  const product = PRODUCTS.find((p) => p.id === line.productId);
  const inside = Object.values(line.breakdown || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
  const joints = Number(product?.joints) || 0;
  if (joints > 0) {
    const noun = product?.slotNoun || (joints === 1 ? 'joint' : 'joints');
    return { qty: Math.max(1, Math.round(Number(line.quantity) || 1)), contents: `${joints} ${noun}` };
  }
  if (!product) {
    return { qty: Math.max(1, Math.round(Number(line.quantity) || 1)), contents: inside > 1 ? `${inside} items` : null };
  }
  return { qty: Math.max(1, Math.round(Number(line.quantity) || inside || 1)), contents: null };
}
