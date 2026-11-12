/**
 * Product photos from the live Venus storefront catalog.
 * Source: https://shop-venus.com/js/shared/products-catalog.js
 * and the collection catalogs (joints-collection-catalog.js,
 * mens-collection-catalog.js). Every file is a static asset at
 * https://shop-venus.com/assets/images/ — not Supabase storage.
 * github.com/ofamba404/venus-store returned 404 from this environment.
 *
 * The shop has no Cookie Quartet and no wholesale product, so those ids
 * have no photo. The Cookies tile uses the Butterscotch Cookie card,
 * which is the shop's lead cookie. A single-flavour cookie line uses
 * that flavour's own card when we know it.
 */

const FILE: Record<string, string> = {
  scout: 'scout-pack.webp',
  pilot: 'bestsellers-pilot-pack.webp',
  commander: 'bestsellers-commanders-stash.webp',
  variety: 'bestsellers-variety-pack.jpg',
  cookie_duet: 'cookie-duet.webp',
  cookie_trio: 'cookie-trio.webp',
  plain_single: 'bestsellers-plain.webp',
  spliff_single: 'bangis.webp',
  cookie_single: 'bestsellers-cookie.jpg',
};

const COOKIE_FLAVOR_FILE: Record<string, string> = {
  cookie_butterscotch: 'bestsellers-cookie.jpg',
  cookie: 'bestsellers-cookie.jpg',
  cookie_mint: 'mint-cookie.webp',
  cookie_strawberry: 'strawberry-cookie.webp',
  cookie_chocolate: 'chocolate-cookie.webp',
};

function assetUrl(file: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}assets/products/${file}`;
}

export function productImageSrc(
  productId: string | null | undefined,
  breakdown?: Record<string, unknown> | null,
): string {
  if (productId === 'cookie_single' && breakdown) {
    const flavours = Object.entries(breakdown)
      .filter(([, qty]) => Number(qty) > 0)
      .map(([id]) => id);
    const only = flavours.length === 1 ? COOKIE_FLAVOR_FILE[flavours[0]!] : '';
    if (only) return assetUrl(only);
  }
  const file = FILE[String(productId || '')];
  return file ? assetUrl(file) : '';
}
