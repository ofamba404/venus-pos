import {
  addPlainLine,
  bumpFirstLine,
  removeSaleLine,
  setLineQty,
} from '../../data/sale-edit';
import { CAT_MAP } from '../../domain/catalog';
import { productImageSrc } from '../../domain/product-art';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { FlavorDot } from '../../ui/FlavorDot';
import { Money } from '../../ui/Money';
import { Segmented } from '../../ui/Segmented';
import { Sheet } from '../../ui/Sheet';

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
          return (
            <div class="v-list-row" key={`${item.product_id}-${index}`}>
              <img class="v-thumb" src={productImageSrc(String(item.product_id || ''))} alt="" />
              <div class="v-list-row__main">
                <div class="v-list-row__title">{item.product_name || 'Item'}</div>
                <div class="v-list-row__meta v-dots">
                  {Object.keys(item.breakdown || {}).map((id) =>
                    CAT_MAP[id] ? <FlavorDot key={id} color={CAT_MAP[id]!.color} /> : null,
                  )}
                  <Money value={Number(item.line_total) || 0} />
                </div>
              </div>
              <Button size="md" variant="secondary" aria-label="Less" onClick={() => onDraft(setLineQty(draft, index, qty - 1))}>
                −
              </Button>
              <span>{qty}</span>
              <Button
                size="md"
                variant="secondary"
                aria-label="More"
                data-testid={index === 0 ? 'sale-edit-inc' : undefined}
                onClick={() => onDraft(index === 0 ? bumpFirstLine(draft) : setLineQty(draft, index, qty + 1))}
              >
                +
              </Button>
              <Button size="md" variant="ghost" aria-label="Remove" onClick={() => onDraft(removeSaleLine(draft, index))}>
                Remove
              </Button>
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
