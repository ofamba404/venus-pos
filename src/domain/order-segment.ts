export type OrderSegment = 'waiting' | 'closed';

/**
 * Which Orders tab a store order sits in. Waiting is everything still to ring up, including an order the store
 * accepted earlier that has no sale yet. Closed is cancelled or checked out.
 */
export function orderSegment(order: { status?: string | null }): OrderSegment {
  if (order.status === 'cancelled' || order.status === 'checked_out') return 'closed';
  return 'waiting';
}
