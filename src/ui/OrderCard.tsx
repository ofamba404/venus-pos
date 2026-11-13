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
        {photos && photos.length ? <ProductGallery slides={photos} size={56} variant="mini" testId="order-gallery" /> : null}
        <div class="order-card__who">
          <div class="order-card__headline">
            <div class="v-list-row__title">{title}</div>
            <Money className="v-money--total" value={total} />
          </div>
          {tags ? <div class="order-card__tags">{tags}</div> : null}
        </div>
      </div>
      {shown.length ? (
        <div class="order-card__lines">
          {shown.map((line, index) => (
            <div class="order-card__line" key={`${line.name}-${index}`}>
              <span class="v-list-row__meta">{line.name}</span>
              <FlavorSwatches breakdown={line.breakdown} productId={line.productId} />
            </div>
          ))}
        </div>
      ) : null}
      {copies ? <div class="order-card__copies">{copies}</div> : null}
      {children}
    </article>
  );
}
