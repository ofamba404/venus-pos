import type { ComponentChildren } from 'preact';

/** One person: who they are, what they owe, when they last bought. The whole row is the tap target. */
export function PersonRow({
  name,
  initial,
  meta,
  tags,
  status,
  testId,
  onOpen,
}: {
  name: string;
  initial: string;
  meta: string;
  /** Small tags under the meta line, such as Storefront. */
  tags?: ComponentChildren;
  /** Right-hand status: the owed tag or Clear. Always sits on the right, vertically centred. */
  status?: ComponentChildren;
  testId?: string;
  onOpen: () => void;
}) {
  return (
    <article class="client-card" data-testid={testId}>
      <button type="button" class="client-card__main" onClick={onOpen}>
        <span class="v-avatar" aria-hidden="true">
          {initial}
        </span>
        <span class="client-card__text">
          <span class="v-list-row__title">{name}</span>
          <span class="v-list-row__meta">{meta}</span>
          {tags ? <span class="client-card__tags">{tags}</span> : null}
        </span>
        {status ? <span class="client-card__status">{status}</span> : null}
      </button>
    </article>
  );
}
