import type { ComponentChildren } from 'preact';

export function Tag({
  tone = 'default',
  children,
}: {
  tone?: 'default' | 'bronze' | 'paid' | 'credit' | 'low' | 'out';
  children: ComponentChildren;
}) {
  return <span class={`v-tag v-tag--${tone}`}>{children}</span>;
}
