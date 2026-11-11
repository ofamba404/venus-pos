import { formatUGX } from '../domain/format';

export function Money({
  value,
  size = 'md',
  className = '',
}: {
  value: number;
  size?: 'md' | 'xl';
  className?: string;
}) {
  return (
    <span class={`v-money ${size === 'xl' ? 'v-money--xl' : ''} ${className}`.trim()}>
      {formatUGX(value)}
    </span>
  );
}
