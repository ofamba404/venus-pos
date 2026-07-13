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
  return `${sales.length}:${head.id}:${head.created_at}:${head.total_ugx}`;
}

export function inventoryFingerprint(inventory) {
  return Object.values(inventory).join(',');
}
