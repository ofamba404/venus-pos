import { PRODUCTS, type Product } from '../domain/catalog';
import { formatUGX } from '../domain/format';
import { productImageSrc } from '../domain/product-art';
import { ProductCard } from './ProductCard';

const LIVE = PRODUCTS.filter((p) => !p.retired);
const JOINTS = LIVE.filter((p) => !String(p.id).startsWith('cookie'));
const COOKIES = LIVE.filter((p) => String(p.id).startsWith('cookie'));

function productKind(p: Product) {
  return String(p.id).startsWith('cookie') ? 'cookie' : 'joint';
}

function productPriceLabel(p: Product) {
  if (p.priceLabel) return p.priceLabel;
  const amount = p.price != null ? p.price : p.unitPrice;
  if (amount == null) return '';
  return p.priceFrom ? `from ${formatUGX(amount)}` : formatUGX(amount);
}

function metaFor(p: Product) {
  if (p.joints != null) return `${p.joints} ${p.slotNoun || (Number(p.joints) === 1 ? 'joint' : 'joints')}`;
  return p.unitLabel || 'per joint';
}

function Section({ label, products, onPick }: { label: string; products: Product[]; onPick: (p: Product) => void }) {
  if (!products.length) return null;
  return (
    <>
      <div class="v-section-label">{label}</div>
      <div class="tile-grid">
        {products.map((p) => (
          <ProductCard
            key={p.id}
            id={p.id}
            name={p.name}
            kind={productKind(p)}
            image={productImageSrc(p.id)}
            art={p.rule === 'cookie_wholesale' ? 'swatches' : undefined}
            meta={metaFor(p)}
            price={productPriceLabel(p)}
            onClick={() => onPick(p)}
          />
        ))}
      </div>
    </>
  );
}

/** Sell (and History's Add item) tiles: Joints, then Cookies. */
export function ProductGrid({ onPick }: { onPick: (product: Product) => void }) {
  return (
    <>
      <Section label="Joints" products={JOINTS} onPick={onPick} />
      <Section label="Cookies" products={COOKIES} onPick={onPick} />
    </>
  );
}

export const SELL_JOINTS = JOINTS;
export const SELL_COOKIES = COOKIES;
