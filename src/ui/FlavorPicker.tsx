import { CAT_MAP, type Product } from '../domain/catalog';
import { configFlavorPool } from '../domain/pricing/pack-config';
import { Field } from './Field';
import { FlavorDot } from './FlavorDot';
import { IconMinus, IconPlus } from './icons';

/**
 * Flavour picker for a pack, a single or wholesale. Sell and the sale editor share it,
 * so a flavour is chosen the same way on both. A picked flavour lights up in its own colour.
 */
export function FlavorPicker({
  product,
  selection,
  sellable,
  onBump,
  onQty,
  onUnit,
}: {
  product: Product;
  selection: Record<string, number>;
  sellable: Record<string, number> | null;
  onBump: (id: string, d: number) => void;
  onQty: (n: number) => void;
  onUnit: (n: number) => void;
}) {
  if (product.rule === 'single_qty') {
    const max = sellable && product.categoryId ? sellable[product.categoryId] ?? 0 : null;
    const qty = selection.qty || 0;
    return (
      <div class="config-flavor">
        <span>
          Quantity
          {max != null ? <span class="v-muted"> · {max} in stock</span> : null}
        </span>
        <div class="stepper">
          <button
            type="button"
            aria-label="Decrease quantity"
            data-testid="config-qty-dec"
            onClick={() => onQty(Math.max(0, qty - 1))}
          >
            <IconMinus size={18} />
          </button>
          <span class="stepper__n">{qty}</span>
          <button
            type="button"
            aria-label="Increase quantity"
            data-testid="config-qty-inc"
            disabled={max != null && qty >= max}
            onClick={() => onQty(qty + 1)}
          >
            <IconPlus size={18} />
          </button>
        </div>
      </div>
    );
  }

  if (product.rule === 'cookie_wholesale') {
    const pool = configFlavorPool(product);
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <Field
          label="Unit price (UGX)"
          inputMode="numeric"
          value={String(selection._unitPrice || '')}
          onInput={(e) => onUnit(Math.max(0, Math.round(Number((e.target as HTMLInputElement).value) || 0)))}
        />
        {pool.map((id) => (
          <FlavorRow
            key={id}
            id={id}
            count={selection[id] || 0}
            max={sellable ? sellable[id] ?? 0 : null}
            onBump={onBump}
          />
        ))}
      </div>
    );
  }

  const pool = configFlavorPool(product);
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {pool.map((id) => (
        <FlavorRow
          key={id}
          id={id}
          count={selection[id] || 0}
          max={sellable ? sellable[id] ?? 0 : null}
          onBump={onBump}
        />
      ))}
      {product.rule === 'choose_variety' ? (
        <p style={{ font: 'var(--t-meta)', color: 'var(--fg-3)' }}>
          Includes fixed {product.fixedFlavor || 'classic'}
        </p>
      ) : null}
    </div>
  );
}

function FlavorRow({
  id,
  count,
  max,
  onBump,
}: {
  id: string;
  count: number;
  max: number | null;
  onBump: (id: string, d: number) => void;
}) {
  const cat = CAT_MAP[id];
  const label =
    cat?.sub && cat.sub !== 'Cookie' ? `${cat.name} ${cat.sub}` : cat?.name || id;
  const atCap = max != null && count >= max;
  return (
    <div
      class={`config-flavor config-flavor--pick${count > 0 ? ' is-picked' : ''}`}
      style={{ '--flavor': cat?.color || '#ccc' } as Record<string, string>}
    >
      <span class="config-flavor__label">
        <FlavorDot color={cat?.color || '#ccc'} size="lg" />
        {label}
        {max != null ? <span class="v-muted"> · {max} in stock</span> : null}
      </span>
      <div class="stepper">
        <button
          type="button"
          aria-label={`Fewer ${label}`}
          data-testid={`config-flavor-${id}-dec`}
          onClick={() => onBump(id, -1)}
        >
          <IconMinus size={18} />
        </button>
        <span class="stepper__n" key={count}>
          {count}
        </span>
        <button
          type="button"
          aria-label={`More ${label}`}
          data-testid={`config-flavor-${id}-inc`}
          disabled={atCap}
          onClick={() => {
            if (atCap) return;
            onBump(id, 1);
          }}
        >
          <IconPlus size={18} />
        </button>
      </div>
    </div>
  );
}
