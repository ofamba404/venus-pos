export type OrderSegment = 'waiting' | 'in_sale' | 'closed';

/**
 * Which Orders tab a store order sits in.
 * Waiting is a new order the store has not confirmed yet.
 * In sale is confirmed or accepted, still to ring up.
 * Closed is cancelled or checked out.
 */
export function orderSegment(order: { status?: string | null; confirmed_at?: string | null }): OrderSegment {
  if (order.status === 'cancelled' || order.status === 'checked_out') return 'closed';
  if (order.status === 'confirmed' || order.status === 'accepted' || Boolean(order.confirmed_at)) return 'in_sale';
  return 'waiting';
}
