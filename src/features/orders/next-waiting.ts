import type { StoreOrderRow } from '../../data/entities';
import { formatUGX } from '../../domain/format';
import { orderSegment } from '../../domain/order-segment';
import { orderTotal } from './order-view';

/** The next store order still in Waiting, in the same order the tab lists them. */
export function nextWaitingOrder(orders: StoreOrderRow[]): StoreOrderRow | null {
  return orders.find((order) => orderSegment(order) === 'waiting') || null;
}

/** A short name for the prompt. Uses the order's own label; the sheet may refine it with account aliases. */
export function waitingOrderName(order: StoreOrderRow): string {
  const direct = String((order as { pos_display_name?: string }).pos_display_name || '').trim();
  if (direct) return direct;
  return String(order.customer_name || '').trim() || 'Store order';
}

/** Items plus a known delivery fee, so the prompt matches what Checkout will show. */
export function waitingOrderTotal(order: StoreOrderRow): number {
  const items = orderTotal(order);
  if (order.delivery_enabled === false) return items;
  if (order.delivery_fee_ugx == null || order.delivery_fee_ugx === undefined) return items;
  const fee = Math.round(Number(order.delivery_fee_ugx) || 0);
  return items + Math.max(0, fee);
}

/** Secondary-button copy: "Next: {client} · UGX X". */
export function waitingOrderPrompt(order: StoreOrderRow): { id: string; name: string; total: number; label: string } {
  const name = waitingOrderName(order);
  const total = waitingOrderTotal(order);
  return { id: order.id, name, total, label: `Next: ${name} · ${formatUGX(total)}` };
}
