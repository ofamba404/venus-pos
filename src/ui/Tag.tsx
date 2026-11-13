import type { ComponentChildren } from 'preact';

export function Tag({
  tone = 'default',
  children,
  testId,
}: {
  tone?: 'default' | 'bronze' | 'bronze-soft' | 'paid' | 'credit' | 'low' | 'out' | 'danger';
  children: ComponentChildren;
  testId?: string;
}) {
  return (
    <span class={`v-tag v-tag--${tone}`} data-testid={testId}>
      {children}
    </span>
  );
}
