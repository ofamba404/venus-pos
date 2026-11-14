import type { StoreOrderRow } from '../../data/entities';
import { formatUGX } from '../../domain/format';
import { orderSegment } from '../../domain/order-segment';
import { orderTotal } from './order-view';

/** The next store order still to ring up: Waiting first, then In sale, in list order. */
export function nextWaitingOrder(orders: StoreOrderRow[]): StoreOrderRow | null {
  return (
    orders.find((order) => orderSegment(order) === 'waiting') ||
    orders.find((order) => orderSegment(order) === 'in_sale') ||
    null
  );
}

/** A short name for the prompt. Uses the order's own label; the sheet may refine it with account aliases. */
export function waitingOrderName(order: StoreOrderRow): string {
  const direct = String((order as { pos_display_name?: string }).pos_display_name || '').trim();
  if (direct) return direct;
  return String(order.customer_name || '').trim() || 'Store order';
}

/** Items only. The delivery fee is not part of the sale. */
export function waitingOrderTotal(order: StoreOrderRow): number {
  return orderTotal(order);
}

/** Secondary-button copy: "Next: {client} · UGX X". */
export function waitingOrderPrompt(order: StoreOrderRow): { id: string; name: string; total: number; label: string } {
  const name = waitingOrderName(order);
  const total = waitingOrderTotal(order);
  return { id: order.id, name, total, label: `Next: ${name} · ${formatUGX(total)}` };
}
