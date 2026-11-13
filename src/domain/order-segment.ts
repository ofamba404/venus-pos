export type OrderSegment = 'waiting' | 'in_sale' | 'closed';

/**
 * Which Orders tab a store order sits in. An order loaded into a sale on this phone (loadedId) stays In sale,
 * even after Confirm writes status 'confirmed'. Unlinking it sends it back to Waiting.
 */
export function orderSegment(order: { id: string; status?: string | null }, loadedId = ''): OrderSegment {
  if (order.status === 'cancelled' || order.status === 'checked_out') return 'closed';
  if (order.status === 'accepted') return 'in_sale';
  if (loadedId && order.id === loadedId) return 'in_sale';
  return 'waiting';
}
