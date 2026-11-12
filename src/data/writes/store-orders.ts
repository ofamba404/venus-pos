export function storeOrderPatchPath(id: string) {
  return `store_orders?id=eq.${encodeURIComponent(id)}`;
}

export function storeOrderCheckedOutBody(saleId: string) {
  return { status: 'checked_out', sale_id: saleId };
}
