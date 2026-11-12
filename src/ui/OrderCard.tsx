import type { ComponentChildren } from 'preact';
import { FlavorSwatches } from './FlavorSwatches';
import { Money } from './Money';

/** An incoming order the cashier can scan: who, what flavours, and the copies they need. */
export function OrderCard({
  title,
  status,
  total,
  image,
  lines,
  children,
}: {
  title: string;
  status: string;
  total: number;
  image?: string;
  lines: Array<{ name: string; productId?: string; breakdown?: Record<string, unknown> }>;
  children: ComponentChildren;
}) {
  return (
    <article class="v-order-card order-card">
      <div class="order-card__top">
        {image ? <img class="v-thumb" src={image} alt="" /> : null}
        <div class="order-card__who">
          <div class="v-list-row__title">{title}</div>
          <div class="v-list-row__meta">{status}</div>
        </div>
        <Money className="v-money--amber" value={total} />
      </div>
      <div class="order-card__lines">
        {lines.slice(0, 3).map((line, index) => (
          <div key={`${line.name}-${index}`}>
            <div class="v-list-row__meta">{line.name}</div>
            <FlavorSwatches breakdown={line.breakdown} productId={line.productId} />
          </div>
        ))}
      </div>
      {children}
    </article>
  );
}
