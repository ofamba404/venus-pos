import { cartTotal } from './cart';
import { formatUGX } from './format';
import { mapStoreOrderToCart, type StoreOrderLike } from './store-order-map';

export function storeOrderName(order: { customer_name?: string | null }, fallback = 'Store order'): string {
  return String(order.customer_name || '').trim() || fallback;
}

export function storeOrderItemStats(order: { items?: unknown; customer_name?: string | null }): { count: number; total: number } {
  const mapped = mapStoreOrderToCart(
    { ...(order as StoreOrderLike), items: (order.items || []) as never },
    { customerName: '' },
  );
  return { count: mapped.lines.length, total: cartTotal(mapped.lines) };
}

/** Cart-bar style line for the Sell review bar. Items-only total, no delivery fee. */
export function reviewBarMeta(orders: Array<{ items?: unknown; customer_name?: string | null }>): string {
  if (orders.length === 1) {
    const order = orders[0]!;
    const { count, total } = storeOrderItemStats(order);
    return `${storeOrderName(order)} · ${count} item${count === 1 ? '' : 's'} · ${formatUGX(total)}`;
  }
  const total = orders.reduce((sum, order) => sum + storeOrderItemStats(order).total, 0);
  return `${orders.length} orders · ${formatUGX(total)}`;
}
