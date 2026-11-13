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
 * What the storefront shows for a pack that is in an order. Each picked flavour is its own
 * single-joint photo in that flavour's colour (assets/images/packs/scout-{flavour}.webp, used
 * for every joint pack, not tinted at run time), one slide per flavour with a ×N badge for
 * repeats, swiped and auto-advanced as a gallery. Cookie packs use the cookie flavour photos and
 * Plain its own photo. A line with no flavour photo to show is one slide with the generic photo.
 * (venus-store js/shared/product-config.js buildAtcImages, grouped by product-image-gallery.js.)
 */
export function productImageSlides(
  productId: string | null | undefined,
  breakdown?: Record<string, unknown> | null,
): ImageSlide[] {
  const id = String(productId || '');
  const cookie = id.startsWith('cookie');
  const slides: ImageSlide[] = [];
  for (const [flavour, qty] of Object.entries(breakdown || {})) {
    const count = Math.round(Number(qty) || 0);
    if (count <= 0 || flavour.startsWith('_')) continue;
    let file = '';
    if (cookie) file = COOKIE_FLAVOR_FILE[flavour] || '';
    else if (flavour === 'classic') file = FILE.plain_single!;
    else if (PACK_FLAVOUR.has(flavour)) file = `scout-${flavour}.webp`;
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

/** Slides for a whole order or sale: every line's flavours, repeats merged into one slide with a count. */
export function itemsImageSlides(
  items: Array<{ product_id?: unknown; productId?: unknown; breakdown?: unknown } | null | undefined>,
): ImageSlide[] {
  const out: ImageSlide[] = [];
  for (const item of items) {
    if (!item) continue;
    const pid = String(item.product_id ?? item.productId ?? '');
    const bd = (item.breakdown && typeof item.breakdown === 'object' ? item.breakdown : null) as Record<string, unknown> | null;
    for (const slide of productImageSlides(pid, bd)) {
      const same = out.find((s) => s.src === slide.src);
      if (same) same.count += slide.count;
      else out.push({ ...slide });
    }
  }
  return out;
}
