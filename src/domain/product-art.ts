/**
 * Product photo files kept beside the register so Sell works offline.
 *
 * These bytes were copied from the public shop site, not from the
 * venus-store git tree. github.com/ofamba404/venus-store is not readable
 * here (clone and the GitHub API both return “repository not found”;
 * it is not in ofamba404’s public repo list), and there is no sibling
 * checkout at ../venus-store. Do not treat this mapping as verified
 * against that repository until the repo can be read.
 *
 * Cookie Quartet and wholesale have no file in this set.
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
