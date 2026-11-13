import { PRODUCTS, type Product } from '../domain/catalog';
import { formatUGX } from '../domain/format';
import { productImageSrc } from '../domain/product-art';
import { ProductCard } from './ProductCard';

const PACKS = PRODUCTS.filter((p) => !p.retired && (p.rule === 'choose_any' || p.rule === 'choose_variety'));
const SINGLES = PRODUCTS.filter(
  (p) => p.rule === 'single_qty' || p.rule === 'spliff_qty' || p.rule === 'cookie_qty',
);
const WHOLESALE = PRODUCTS.filter((p) => p.rule === 'cookie_wholesale');

function productKind(p: Product) {
  return String(p.id).startsWith('cookie') ? 'cookie' : 'joint';
}

function productPriceLabel(p: Product) {
  if (p.priceLabel) return p.priceLabel;
  const amount = p.price != null ? p.price : p.unitPrice;
  if (amount == null) return '';
  return p.priceFrom ? `from ${formatUGX(amount)}` : formatUGX(amount);
}

/** The product tiles Sell sells from: Packs, Singles, Wholesale. History's Add item uses the very same grid. */
export function ProductGrid({ onPick }: { onPick: (product: Product) => void }) {
  return (
    <>
      <div class="v-section-label">Packs</div>
      <div class="tile-grid">
        {PACKS.map((p) => (
          <ProductCard
            key={p.id}
            id={p.id}
            name={p.name}
            kind={productKind(p)}
            image={productImageSrc(p.id)}
            meta={`${p.joints} ${p.slotNoun || (Number(p.joints) === 1 ? 'joint' : 'joints')}`}
            price={productPriceLabel(p)}
            onClick={() => onPick(p)}
          />
        ))}
      </div>
      <div class="v-section-label">Singles</div>
      <div class="tile-grid">
        {SINGLES.map((p) => (
          <ProductCard
            key={p.id}
            id={p.id}
            name={p.name}
            kind={productKind(p)}
            image={productImageSrc(p.id)}
            meta={p.unitLabel || 'per joint'}
            price={productPriceLabel(p)}
            onClick={() => onPick(p)}
          />
        ))}
      </div>
      {WHOLESALE.length ? (
        <>
          <div class="v-section-label">Wholesale</div>
          <div class="tile-grid">
            {WHOLESALE.map((p) => (
              <ProductCard
                key={p.id}
                id={p.id}
                name={p.name}
                kind={productKind(p)}
                image={productImageSrc(p.id)}
                art="swatches"
                price={productPriceLabel(p)}
                onClick={() => onPick(p)}
              />
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
