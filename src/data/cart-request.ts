import { signal } from '@preact/signals';

/**
 * "Review sale" from another page. The Sell page owns the Review sale sheet, so other pages ask for it
 * here, then navigate. Sell opens the sheet in place on arrival and clears the request.
 */
export const cartOpenWanted = signal(false);

export function requestCartOpen() {
  cartOpenWanted.value = true;
}

export function takeCartOpenRequest(): boolean {
  const wanted = cartOpenWanted.value;
  cartOpenWanted.value = false;
  return wanted;
}
