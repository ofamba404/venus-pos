/** Tiny memo cache — invalidates when key changes. */
export function createMemo() {
  let lastKey = null;
  let lastValue = null;

  return function memoize(key, compute) {
    if (key === lastKey && lastValue != null) return lastValue;
    lastKey = key;
    lastValue = compute();
    return lastValue;
  };
}

export function salesFingerprint(sales) {
  if (!sales.length) return '0';
  const head = sales[0];
  // Include fields that mutate without changing length / head identity
  // (credit clear, edit total on an older sale, etc.) so overview memo busts.
  let revenue = 0;
  let paidSig = 0;
  let creditSig = 0;
  for (let i = 0; i < sales.length; i++) {
    const s = sales[i];
    revenue += Number(s.total_ugx) || 0;
    paidSig += Number(s.amount_paid_ugx) || 0;
    if (s.is_credit) creditSig += s.credit_cleared ? 2 : 1;
  }
  return `${sales.length}:${head.id}:${head.created_at}:${revenue}:${paidSig}:${creditSig}`;
}

export function inventoryFingerprint(inventory) {
  return Object.values(inventory).join(',');
}
