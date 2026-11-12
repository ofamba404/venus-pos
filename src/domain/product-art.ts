/** Storefront product photos from shop-venus.com, kept local so Sell works offline. */

const FILE: Record<string, string> = {
  scout: 'mint.webp',
  pilot: 'pilot.webp',
  commander: 'commander.webp',
  variety: 'variety.jpg',
  cookie_duet: 'cookie-duet.webp',
  cookie_trio: 'cookie-trio.webp',
  cookie_quartet: 'cookies.webp',
  cookie_single: 'cookies.webp',
  cookie_wholesale: 'cookies.webp',
  plain_single: 'plain.webp',
  spliff_single: 'bangis.webp',
};

export function productImageSrc(productId: string | null | undefined): string {
  const file = FILE[String(productId || '')] || 'plain.webp';
  const base = import.meta.env.BASE_URL || '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}assets/products/${file}`;
}
