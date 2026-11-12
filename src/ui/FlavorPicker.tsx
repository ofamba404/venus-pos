import { CAT_MAP, type Product } from '../domain/catalog';
import {
  configFlavorPool,
  configRemaining,
  configTarget,
  configTotalSelected,
  varietyFixedFlavor,
} from '../domain/pricing/pack-config';
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
  const target = configTarget(product);
  const full = configRemaining(product, selection) === 0;
  const fixedId = product.rule === 'choose_variety' ? varietyFixedFlavor(product) : '';
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {target !== null ? (
        <SlotMeter
          product={product}
          selection={selection}
          pool={pool}
          total={target + (fixedId ? 1 : 0)}
          fixedId={fixedId}
        />
      ) : null}
      {pool.map((id) => (
        <FlavorRow
          key={id}
          id={id}
          count={selection[id] || 0}
          max={sellable ? sellable[id] ?? 0 : null}
          full={full}
          onBump={onBump}
        />
      ))}
      {fixedId ? (
        <p style={{ font: 'var(--t-meta)', color: 'var(--fg-3)' }}>
          Plus 1 {CAT_MAP[fixedId]?.name || fixedId}, always included
        </p>
      ) : null}
    </div>
  );
}

/** One slot per joint (or cookie) in the pack. They fill with the picked flavours' colours. */
function SlotMeter({
  product,
  selection,
  pool,
  total,
  fixedId,
}: {
  product: Product;
  selection: Record<string, number>;
  pool: string[];
  total: number;
  fixedId: string;
}) {
  const picked: string[] = [];
  for (const id of pool) {
    for (let i = 0; i < (Number(selection[id]) || 0); i += 1) picked.push(id);
  }
  const target = configTarget(product) || 0;
  const slots = Array.from({ length: total }, (_, i) =>
    i < target ? picked[i] : fixedId,
  );
  const done = Math.min(picked.length, target) + (fixedId ? 1 : 0);
  const noun = product.slotNoun || (total === 1 ? 'joint' : 'joints');
  const over = configTotalSelected(selection) > target;
  return (
    <div
      class={`slot-meter${over ? ' is-over' : ''}`}
      role="status"
      aria-label={`${done} of ${total} ${noun} selected`}
      data-testid="slot-meter"
      data-picked={configTotalSelected(selection)}
      data-target={target}
    >
      <span class="slot-meter__count">
        {done}
        <span class="slot-meter__of"> of {total}</span>
      </span>
      <span class="slot-meter__slots" aria-hidden="true">
        {slots.map((id, i) => (
          <i
            key={i}
            class={id ? 'is-filled' : ''}
            style={id ? ({ '--flavor': CAT_MAP[id]?.color || '#ccc' } as Record<string, string>) : undefined}
          />
        ))}
      </span>
    </div>
  );
}

function FlavorRow({
  id,
  count,
  max,
  full = false,
  onBump,
}: {
  id: string;
  count: number;
  max: number | null;
  /** The pack has no open slots, so nothing more can be added. */
  full?: boolean;
  onBump: (id: string, d: number) => void;
}) {
  const cat = CAT_MAP[id];
  const label =
    cat?.sub && cat.sub !== 'Cookie' ? `${cat.name} ${cat.sub}` : cat?.name || id;
  const atCap = full || (max != null && count >= max);
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
