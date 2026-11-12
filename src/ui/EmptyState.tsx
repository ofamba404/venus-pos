/** What to do next when a list is empty. A blank page does not say that. */
export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div class="v-empty empty-state">
      <p class="v-empty__title">{title}</p>
      {body ? <p>{body}</p> : null}
    </div>
  );
}
