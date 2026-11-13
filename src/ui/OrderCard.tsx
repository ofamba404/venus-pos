import type { ComponentChildren } from 'preact';
import type { ImageSlide } from '../domain/product-art';
import { ProductGallery } from './ProductGallery';
import { FlavorSwatches } from './FlavorSwatches';
import { Money } from './Money';

/** An incoming order the cashier can scan: who, what flavours, and the copies they need. */
export function OrderCard({
  title,
  total,
  photos,
  lines,
  copies,
  tags,
  children,
}: {
  title: string;
  total: number;
  /** Photos for the whole order: one per flavour, like the storefront. */
  photos?: ImageSlide[];
  lines: Array<{ name: string; productId?: string; breakdown?: Record<string, unknown> }>;
  /** Labelled copy pills, one compact row under the lines. */
  copies?: ComponentChildren;
  /** Status tags under the name: Delivery or Pickup, and the green Confirmed tag. */
  tags?: ComponentChildren;
  children: ComponentChildren;
}) {
  const shown = lines.filter((line) => line.name && line.name !== 'Item').slice(0, 3);
  return (
    <article class="v-order-card order-card">
      <div class="order-card__top">
        {photos && photos.length ? <ProductGallery slides={photos} size={44} variant="mini" testId="order-gallery" /> : null}
        <div class="order-card__who">
          <div class="v-list-row__title">{title}</div>
          {tags ? <div class="order-card__tags">{tags}</div> : null}
        </div>
        <Money className="v-money--total" value={total} />
      </div>
      <div class="order-card__mid">
        <div class="order-card__lines">
          {shown.map((line, index) => (
            <div key={`${line.name}-${index}`}>
              <div class="v-list-row__meta">{line.name}</div>
              <FlavorSwatches breakdown={line.breakdown} productId={line.productId} />
            </div>
          ))}
        </div>
      </div>
      {copies ? <div class="order-card__copies">{copies}</div> : null}
      {children}
    </article>
  );
}
