/**
 * Product photo files kept beside the register so Sell works offline.
 *
 * The twelve catalog files in public/assets/products/ are verified
 * byte-identical to venus-store assets/images at 0e629f9. The per-flavour
 * Scout, Pilot, and Commander photos are the same commit's
 * assets/images/packs/, resized to 512px so a thumb does not decode a
 * 3072px file. A line that is one of those flavours uses that photo.
 * A mix, or a tile before a flavour is chosen, keeps the generic pack photo.
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

/** File prefix in assets/images/packs/. Commander is `commanders-` there. */
const PACK_FILE_PREFIX: Record<string, string> = {
  scout: 'scout',
  pilot: 'pilot',
  commander: 'commanders',
};

const PACK_FLAVOUR = new Set([
  'mint',
  'strawberry',
  'blueberry',
  'watermelon',
  'grape',
  'coconut',
  'melon',
]);

function assetUrl(file: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}assets/products/${file}`;
}

function chosenIds(breakdown?: Record<string, unknown> | null): string[] {
  return Object.entries(breakdown || {})
    .filter(([, qty]) => Number(qty) > 0)
    .map(([id]) => id);
}

export function productImageSrc(
  productId: string | null | undefined,
  breakdown?: Record<string, unknown> | null,
): string {
  const id = String(productId || '');
  const chosen = chosenIds(breakdown);
  if (id === 'cookie_single' && chosen.length === 1) {
    const only = COOKIE_FLAVOR_FILE[chosen[0]!];
    if (only) return assetUrl(only);
  }
  const pack = PACK_FILE_PREFIX[id];
  const flavour = chosen.length === 1 ? chosen[0]! : '';
  if (pack && PACK_FLAVOUR.has(flavour)) return assetUrl(`${pack}-${flavour}.webp`);
  const file = FILE[id];
  return file ? assetUrl(file) : '';
}

export interface ImageSlide {
  src: string;
  /** How many of this flavour are in the line. Shown as a ×N badge when above one. */
  count: number;
}

/**
 * One slide per flavour in the line, each with that flavour's own photo, the way the
 * storefront cart drawer builds its swipe gallery. A line with no breakdown, or no
 * flavour photos to show, is one slide with the generic photo.
 */
export function productImageSlides(
  productId: string | null | undefined,
  breakdown?: Record<string, unknown> | null,
): ImageSlide[] {
  const id = String(productId || '');
  const cookie = id.startsWith('cookie');
  const prefix = PACK_FILE_PREFIX[id] || (id === 'choose_variety' || id === 'variety' ? 'scout' : '');
  const slides: ImageSlide[] = [];
  for (const [flavour, qty] of Object.entries(breakdown || {})) {
    const count = Math.round(Number(qty) || 0);
    if (count <= 0 || flavour.startsWith('_')) continue;
    let file = '';
    if (cookie) file = COOKIE_FLAVOR_FILE[flavour] || '';
    else if (flavour === 'classic') file = FILE.plain_single!;
    else if (prefix && PACK_FLAVOUR.has(flavour)) file = `${prefix}-${flavour}.webp`;
    if (!file) continue;
    const src = assetUrl(file);
    const existing = slides.find((s) => s.src === src);
    if (existing) existing.count += count;
    else slides.push({ src, count });
  }
  if (slides.length) return slides;
  const generic = productImageSrc(id, breakdown);
  return generic ? [{ src: generic, count: 1 }] : [];
}

/** Sum the flavours of every cart line per product, so a pack tile can show what is in the cart. */
export function selectedByProduct(
  lines: Array<{ productId: string; breakdown?: Record<string, unknown> | null }>,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const line of lines) {
    for (const [flavour, qty] of Object.entries(line.breakdown || {})) {
      const n = Number(qty) || 0;
      if (n <= 0 || flavour.startsWith('_')) continue;
      const bucket = (out[line.productId] ||= {});
      bucket[flavour] = (bucket[flavour] || 0) + n;
    }
  }
  return out;
}
