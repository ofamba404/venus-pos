import type { ComponentChildren, JSX } from 'preact';

type Props = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'lg' | 'xl';
  /** Shows a spinner at the left edge and disables the button. The label is left alone, so the width does not move. */
  loading?: boolean;
  children: ComponentChildren;
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  loading = false,
  disabled,
  children,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      class={`v-btn v-btn--${variant} v-btn--${size}${loading ? ' is-loading' : ''} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span class="v-btn__spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
