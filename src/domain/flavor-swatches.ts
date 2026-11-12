/**
 * Which flavours a line shows, and in what order.
 * Repeats keep a count. A variety pack's fixed flavour (Plain, or butterscotch
 * on the quartet) sits after the others. Extra flavours collapse to +N.
 */
import { CAT_MAP } from './catalog';
import { findProduct, varietyFixedFlavor } from './pricing/pack-config';

export type FlavorSwatch = {
  id: string;
  name: string;
  color: string;
  qty: number;
};

/** Max flavour dots in a row before the rest collapse into +N. */
export const SWATCH_VISIBLE = 8;

export function flavorEntries(
  breakdown: Record<string, unknown> | null | undefined,
): FlavorSwatch[] {
  return Object.entries(breakdown || {})
    .filter(([, qty]) => Number(qty) > 0)
    .map(([id, qty]) => {
      const cat = CAT_MAP[id];
      if (!cat) return null;
      return { id, qty: Number(qty), name: cat.name, color: cat.color };
    })
    .filter((row): row is FlavorSwatch => row !== null);
}

export function flavorSwatchLabel(entries: FlavorSwatch[]): string {
  return entries.map((entry) => (entry.qty > 1 ? `${entry.name} ×${entry.qty}` : entry.name)).join(', ');
}

export function flavorSwatchLayout(
  breakdown: Record<string, unknown> | null | undefined,
  productId?: string | null,
) {
  const entries = flavorEntries(breakdown);
  const product = findProduct(productId);
  const fixedId = product?.rule === 'choose_variety' ? varietyFixedFlavor(product) : null;
  let flavors = entries;
  let plain: FlavorSwatch | null = null;
  if (fixedId) {
    plain = entries.find((entry) => entry.id === fixedId) || null;
    flavors = entries.filter((entry) => entry.id !== fixedId);
  }
  const flavorSlots = Math.max(0, SWATCH_VISIBLE - (plain ? 1 : 0));
  const visible = flavors.slice(0, flavorSlots);
  const overflow = flavors.length - visible.length;
  const ordered = plain ? [...flavors, plain] : entries;
  return {
    label: flavorSwatchLabel(ordered),
    visible,
    overflow,
    plain,
    separatePlain: Boolean(plain && (visible.length > 0 || overflow > 0)),
  };
}
