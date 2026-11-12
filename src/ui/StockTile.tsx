import type { ComponentChildren } from 'preact';
import { FlavorDot } from './FlavorDot';
import { Tag } from './Tag';

/** One flavour you can count. The colour is the name; the number is the stock. */
export function StockTile({
  name,
  color,
  level,
  children,
}: {
  name: string;
  color: string;
  level: 'ok' | 'low' | 'out';
  children: ComponentChildren;
}) {
  return (
    <div class="stock-row stock-tile">
      <FlavorDot color={color} hollow={level === 'out'} size="lg" />
      <div class="stock-row__label">
        <div class="stock-row__name">{name}</div>
        {level !== 'ok' ? <Tag tone={level === 'low' ? 'low' : 'out'}>{level}</Tag> : null}
      </div>
      {children}
    </div>
  );
}
