import type { ComponentChildren } from 'preact';

function stars(rating: number) {
  const n = Math.max(0, Math.min(5, Math.round(rating || 0)));
  return `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`;
}

/** A review is a quote with a verdict, not a line of text. Actions stay with the quote. */
export function ReviewCard({
  id,
  name,
  rating,
  body,
  status,
  children,
}: {
  id: string;
  name: string;
  rating: number;
  body: string;
  status: string;
  children: ComponentChildren;
}) {
  return (
    <article class="v-review review-card" data-testid={`review-${id}`}>
      <div class="v-review__stars" aria-label={`${rating} stars`}>
        {stars(rating)}
      </div>
      <div class="review-card__who">
        <div class="v-list-row__title">{name}</div>
        <span class={`v-tag ${status === 'hidden' ? '' : 'v-tag--paid'}`}>{status}</span>
      </div>
      <p class="review-card__body">{body}</p>
      {children}
    </article>
  );
}
