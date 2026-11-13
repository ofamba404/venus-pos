import type { ComponentChildren } from 'preact';
import type { ImageSlide } from '../domain/product-art';
import { ProductGallery } from './ProductGallery';
import { FlavorSwatches } from './FlavorSwatches';

/** A past sale you can recognise without opening it: person, product, flavours. */
export function HistoryRow({
  testId,
  name,
  when,
  photos,
  lines,
  tags,
  amount,
  onOpen,
}: {
  testId: string;
  name: string;
  when: string;
  /** Photos for the whole sale: one per flavour. Swipe by hand; no auto-advance in a long list. */
  photos?: ImageSlide[];
  lines: Array<{ name: string; productId?: string; breakdown?: Record<string, unknown> }>;
  tags: ComponentChildren;
  amount: ComponentChildren;
  onOpen: () => void;
}) {
  return (
    <button type="button" class="history-row" data-testid={testId} onClick={onOpen}>
      {photos && photos.length ? <ProductGallery slides={photos} size={44} variant="mini" autoplay={false} testId="history-gallery" /> : null}
      <span class="history-row__main">
        <span class="v-list-row__title">{name}</span>
        {lines.slice(0, 2).map((line, index) => (
          <span key={`${line.name}-${index}`} class="history-row__line">
            <span class="v-list-row__meta">{line.name}</span>
            <FlavorSwatches breakdown={line.breakdown} productId={line.productId} />
          </span>
        ))}
        <span class="v-list-row__meta">{when}</span>
      </span>
      {tags}
      {amount}
    </button>
  );
}
