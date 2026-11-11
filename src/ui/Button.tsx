import type { ComponentChildren, JSX } from 'preact';

type Props = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'lg' | 'xl';
  children: ComponentChildren;
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      class={`v-btn v-btn--${variant} v-btn--${size} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}
