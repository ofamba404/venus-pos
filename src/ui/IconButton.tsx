import type { ComponentChildren, JSX } from 'preact';

type Props = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  size?: 'sm' | 'md';
  children: ComponentChildren;
};

export function IconButton({
  label,
  size = 'md',
  className = '',
  children,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      class={`v-icon-btn v-icon-btn--${size} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}
