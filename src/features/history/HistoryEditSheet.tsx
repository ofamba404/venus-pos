import { useState } from 'preact/hooks';
import {
  addConfiguredLine,
  bumpLine,
  canDecrement,
  flavourProduct,
  flavourSelection,
  lineQuantity,
  newItemSelection,
  reflavourLine,
  removeSaleLine,
  saleItemsTotal,
  type SaleItem,
} from '../../data/sale-edit';
import type { Product } from '../../domain/catalog';
import { configReady, configTarget, type ConfigSelection } from '../../domain/pricing/pack-config';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { FlavorPicker } from '../../ui/FlavorPicker';
import { ProductGallery } from '../../ui/ProductGallery';
import { FlavorSwatches } from '../../ui/FlavorSwatches';
import { ProductGrid } from '../../ui/ProductGrid';
import { Money } from '../../ui/Money';
import { Segmented } from '../../ui/Segmented';
import { Sheet } from '../../ui/Sheet';
import { IconMinus, IconPlus } from '../../ui/icons';

type Item = SaleItem;

export function HistoryEditSheet({
  open,
  busy,
  draft,
  name,
  credit,
  cleared,
  onClose,
  onName,
  onCredit,
  onCleared,
  onDraft,
  onSave,
}: {
  open: boolean;
  busy: boolean;
  draft: Item[];
  name: string;
  credit: boolean;
  cleared: boolean;
  onClose: () => void;
  onName: (value: string) => void;
  onCredit: (credit: boolean) => void;
  onCleared: (cleared: boolean) => void;
  onDraft: (items: Item[]) => void;
  onSave: () => void;
}) {
  // One sheet, two views: the sale, and the flavour picker for one line of it.
  const [picking, setPicking] = useState<{ index: number; selection: ConfigSelection } | null>(null);
  const pickItem = picking ? draft[picking.index] : undefined;
  const pickProduct = flavourProduct(pickItem);
  // Add item: the same product tiles as Sell, then the same capped picker for the product chosen.
  const [catalog, setCatalog] = useState(false);
  const [adding, setAdding] = useState<{ product: Product; selection: ConfigSelection } | null>(null);

  function bumpAdding(id: string, delta: number) {
    setAdding((cur) => {
      if (!cur) return cur;
      const next = { ...cur.selection };
      const n = Math.max(0, (Number(next[id]) || 0) + delta);
      if (n === 0) delete next[id];
      else next[id] = n;
      return { ...cur, selection: next };
    });
  }

  function bump(id: string, delta: number) {
    setPicking((cur) => {
      if (!cur) return cur;
      const next = { ...cur.selection };
      const n = Math.max(0, (Number(next[id]) || 0) + delta);
      if (n === 0) delete next[id];
      else next[id] = n;
      return { ...cur, selection: next };
    });
  }

  if (adding) {
    const canAdd = configReady(adding.product, adding.selection);
    return (
      <Sheet
        open={open}
        title={`Add · ${adding.product.name}`}
        onClose={() => setAdding(null)}
        dismissible={false}
        footer={
          <div class="edit-picker__foot">
            <Button size="xl" variant="secondary" data-testid="sale-add-back" onClick={() => setAdding(null)}>
              Back
            </Button>
            <Button
              size="xl"
              data-testid="sale-add-apply"
              disabled={!canAdd}
              onClick={() => {
                onDraft(addConfiguredLine(draft, adding.product, adding.selection));
                setAdding(null);
                setCatalog(false);
              }}
            >
              {canAdd
                ? 'Add to sale'
                : configTarget(adding.product) === null
                  ? 'Pick at least one'
                  : `Pick ${configTarget(adding.product)} to add`}
            </Button>
          </div>
        }
      >
        <FlavorPicker
          product={adding.product}
          selection={adding.selection}
          sellable={null}
          onBump={bumpAdding}
          onQty={(qty) => setAdding((cur) => (cur ? { ...cur, selection: { qty } } : cur))}
          onUnit={(n) => setAdding((cur) => (cur ? { ...cur, selection: { ...cur.selection, _unitPrice: n } } : cur))}
        />
      </Sheet>
    );
  }

  if (catalog) {
    return (
      <Sheet
        open={open}
        title="Add item"
        onClose={() => setCatalog(false)}
        dismissible={false}
        footer={
          <Button size="xl" variant="secondary" data-testid="sale-add-close" onClick={() => setCatalog(false)}>
            Back to sale
          </Button>
        }
      >
        <div data-testid="sale-add-catalog">
          <ProductGrid onPick={(product) => setAdding({ product, selection: newItemSelection(product) })} />
        </div>
      </Sheet>
    );
  }

  if (picking && pickItem && pickProduct) {
    const canApply = configReady(pickProduct, picking.selection);
    return (
      <Sheet
        open={open}
        title={`Flavours · ${pickItem.product_name || pickProduct.name}`}
        onClose={() => setPicking(null)}
        dismissible={false}
        footer={
          <div class="edit-picker__foot">
            <Button size="xl" variant="secondary" data-testid="sale-edit-flavours-back" onClick={() => setPicking(null)}>
              Back
            </Button>
            <Button
              size="xl"
              data-testid="sale-edit-flavours-apply"
              disabled={!canApply}
              onClick={() => {
                onDraft(reflavourLine(draft, picking.index, picking.selection));
                setPicking(null);
              }}
            >
              {canApply
                ? 'Use these flavours'
                : configTarget(pickProduct) === null
                  ? 'Pick at least one'
                  : `Pick ${configTarget(pickProduct)} to continue`}
            </Button>
          </div>
        }
      >
        <FlavorPicker
          product={pickProduct}
          selection={picking.selection}
          sellable={null}
          onBump={bump}
          onQty={(qty) => setPicking((cur) => (cur ? { ...cur, selection: { qty } } : cur))}
          onUnit={(n) => setPicking((cur) => (cur ? { ...cur, selection: { ...cur.selection, _unitPrice: n } } : cur))}
        />
      </Sheet>
    );
  }

  return (
    <Sheet open={open} title="Edit sale" onClose={onClose} dismissible={false}>
      <div style={{ display: 'grid', gap: 12 }}>
        <Field
          label="Client"
          data-testid="sale-edit-customer"
          value={name}
          placeholder="Client name"
          onInput={(e) => onName((e.target as HTMLInputElement).value)}
        />
        <Segmented
          value={credit ? 'credit' : 'paid'}
          onChange={(id) => onCredit(id === 'credit')}
          options={[
            { id: 'paid', label: 'Paid' },
            { id: 'credit', label: 'On credit' },
          ]}
        />
        {credit ? (
          <Segmented
            value={cleared ? 'cleared' : 'open'}
            onChange={(id) => onCleared(id === 'cleared')}
            options={[
              { id: 'open', label: 'Unpaid' },
              { id: 'cleared', label: 'Cleared' },
            ]}
          />
        ) : null}
        {draft.map((item, index) => {
          const qty = lineQuantity(item);
          const canPick = Boolean(flavourProduct(item));
          return (
            <div class="edit-line" key={`${item.product_id}-${index}`} data-testid={`sale-edit-line-${index}`}>
              <div class="edit-line__top">
                <ProductGallery
                  productId={String(item.product_id || '')}
                  breakdown={item.breakdown as Record<string, unknown>}
                  size={64}
                  testId="edit-line-gallery"
                />
                <div class="v-list-row__main">
                  <div class="edit-line__title">{item.product_name || 'Item'}</div>
                  <FlavorSwatches
                    breakdown={item.breakdown as Record<string, unknown>}
                    productId={String(item.product_id || '')}
                  />
                </div>
                <Money className="v-money--total" value={Number(item.line_total) || 0} />
              </div>
              <div class="edit-line__tools">
                {canPick ? (
                  <button
                    type="button"
                    class="edit-line__flavours"
                    data-testid={`sale-edit-flavours-${index}`}
                    onClick={() => setPicking({ index, selection: flavourSelection(item) })}
                  >
                    Change flavours
                  </button>
                ) : null}
                <div class="stepper">
                  <button
                    type="button"
                    aria-label="Less"
                    disabled={!canDecrement(draft, index)}
                    onClick={() => onDraft(bumpLine(draft, index, -1))}
                  >
                    <IconMinus size={18} />
                  </button>
                  <span class="stepper__n">{qty}</span>
                  <button
                    type="button"
                    aria-label="More"
                    data-testid={index === 0 ? 'sale-edit-inc' : undefined}
                    onClick={() => onDraft(bumpLine(draft, index, 1))}
                  >
                    <IconPlus size={18} />
                  </button>
                </div>
                <button
                  type="button"
                  class="edit-line__remove"
                  aria-label="Remove"
                  onClick={() => onDraft(removeSaleLine(draft, index))}
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
        <Button variant="secondary" data-testid="sale-edit-add" onClick={() => setCatalog(true)}>
          Add item
        </Button>
        <div class="edit-total" data-testid="sale-edit-total">
          <span class="cart-total__label">Total</span>
          <Money className="v-money--total" value={saleItemsTotal(draft)} size="xl" />
        </div>
        <Button data-testid="sale-edit-save" disabled={busy || !draft.length} onClick={onSave}>
          Save sale
        </Button>
      </div>
    </Sheet>
  );
}
