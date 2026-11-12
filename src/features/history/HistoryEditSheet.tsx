import { useState } from 'preact/hooks';
import {
  addPlainLine,
  bumpFirstLine,
  flavourProduct,
  flavourSelection,
  reflavourLine,
  removeSaleLine,
  selectionCount,
  setLineQty,
} from '../../data/sale-edit';
import type { ConfigSelection } from '../../domain/pricing/pack-config';
import { productImageSrc } from '../../domain/product-art';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { FlavorPicker } from '../../ui/FlavorPicker';
import { FlavorSwatches } from '../../ui/FlavorSwatches';
import { Money } from '../../ui/Money';
import { Segmented } from '../../ui/Segmented';
import { Sheet } from '../../ui/Sheet';
import { IconMinus, IconPlus } from '../../ui/icons';

type Item = ReturnType<typeof setLineQty>[number];

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

  if (picking && pickItem && pickProduct) {
    const canApply = selectionCount(picking.selection) > 0 || pickProduct.rule === 'choose_variety';
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
              Use these flavours
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
          label="Customer"
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
          const qty = Math.max(1, Math.round(Number(Object.values(item.breakdown || {})[0]) || 1));
          const art = productImageSrc(String(item.product_id || ''), item.breakdown as Record<string, unknown>);
          const canPick = Boolean(flavourProduct(item));
          return (
            <div class="edit-line" key={`${item.product_id}-${index}`} data-testid={`sale-edit-line-${index}`}>
              <div class="edit-line__top">
                {art ? <img class="v-thumb" src={art} alt="" /> : null}
                <div class="v-list-row__main">
                  <div class="edit-line__title">{item.product_name || 'Item'}</div>
                  <FlavorSwatches
                    breakdown={item.breakdown as Record<string, unknown>}
                    productId={String(item.product_id || '')}
                  />
                </div>
                <Money className="v-money--amber" value={Number(item.line_total) || 0} />
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
                  <button type="button" aria-label="Less" onClick={() => onDraft(setLineQty(draft, index, qty - 1))}>
                    <IconMinus size={18} />
                  </button>
                  <span class="stepper__n">{qty}</span>
                  <button
                    type="button"
                    aria-label="More"
                    data-testid={index === 0 ? 'sale-edit-inc' : undefined}
                    onClick={() => onDraft(index === 0 ? bumpFirstLine(draft) : setLineQty(draft, index, qty + 1))}
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
        <Button variant="secondary" data-testid="sale-edit-add" onClick={() => onDraft(addPlainLine(draft))}>
          Add Plain
        </Button>
        <Button data-testid="sale-edit-save" disabled={busy || !draft.length} onClick={onSave}>
          Save sale
        </Button>
      </div>
    </Sheet>
  );
}
