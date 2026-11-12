import type { ComponentChildren } from 'preact';

/** One person: who they are, what they owe, when they last bought. Not a spreadsheet row. */
export function ClientCard({
  name,
  initial,
  meta,
  owed,
  onOpen,
  edit,
}: {
  name: string;
  initial: string;
  meta: string;
  owed?: ComponentChildren;
  onOpen: () => void;
  edit: ComponentChildren;
}) {
  return (
    <article class="client-card">
      <button type="button" class="client-card__main" onClick={onOpen}>
        <span class="v-avatar" aria-hidden="true">
          {initial}
        </span>
        <span class="client-card__text">
          <span class="v-list-row__title">{name}</span>
          <span class="v-list-row__meta">{meta}</span>
        </span>
        {owed}
      </button>
      {edit}
    </article>
  );
}
