import { useState } from 'preact/hooks';
import './insights.css';
import { sales } from '../../data/entities';
import { settleCredit } from '../../data/credit-settle';
import { getOutstandingCredit, type CreditSale } from '../../domain/credit';
import { creditHeadline, type CreditBook, type CreditOrder, type CreditPerson } from '../../domain/credit-book';
import { formatUGX } from '../../domain/format';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Money } from '../../ui/Money';
import { Sheet } from '../../ui/Sheet';
import { showToast } from '../../ui/ToastHost';
import { IconChevronRight } from '../../ui/icons';

type Target = { person: CreditPerson; order: CreditOrder | null };

function plain(n: number) {
  return Math.round(n).toLocaleString('en-UG');
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function copyPhone(digits: string) {
  void navigator.clipboard?.writeText(digits).then(
    () => showToast('Phone copied'),
    () => showToast(digits),
  );
}

/**
 * Credit, collapsed to one line and an age bar. Tap it for a row per person,
 * tap a person for their orders, and settle one order or everything they owe.
 */
export function CreditCard({
  book,
  collected,
  phrase,
  onSettled,
}: {
  book: CreditBook;
  /** Credit payments received in the range. Null when they could not be read. */
  collected: number | null;
  phrase: string;
  onSettled: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const settled = book.owed <= 0;
  const live = book.buckets.filter((b) => b.amount > 0);
  const line = (
    <span class="credit__line" data-testid="credit-headline">
      {settled ? (
        <strong>{creditHeadline(book)}</strong>
      ) : (
        <>
          <strong>{formatUGX(book.owed)}</strong> owed by {book.people.length} {book.people.length === 1 ? 'person' : 'people'}
        </>
      )}
      {collected !== null && collected > 0 ? ` · collected ${plain(collected)} ${phrase}` : ''}
    </span>
  );

  function begin(person: CreditPerson, order: CreditOrder | null) {
    setTarget({ person, order });
    setAmount(String(order ? order.balance : person.owed));
    setNote('');
  }

  const targetOwed = target ? (target.order ? target.order.balance : target.person.owed) : 0;

  async function settle() {
    if (!target) return;
    const wanted = new Set((target.order ? [target.order] : target.person.orders).map((o) => o.id));
    const openSales = getOutstandingCredit(sales.value as CreditSale[]).filter((s) => wanted.has(String(s.id)));
    setBusy(true);
    const result = await settleCredit({ openSales, clientId: target.person.clientId, amount: Number(amount), note });
    setBusy(false);
    if (!result.ok) {
      showToast(result.error);
      return;
    }
    showToast(`Settled ${result.paid.toLocaleString('en-UG')} UGX`);
    setTarget(null);
    await onSettled();
  }

  return (
    <section class="decision credit" aria-label="Who owes me" data-testid="insights-credit" data-owed={book.owed}>
      <h2 class="decision__q">Who owes me?</h2>
      {settled ? (
        <div class="credit__card credit__card--static" data-testid="credit-settled">
          {line}
        </div>
      ) : (
        <button
          type="button"
          class="credit__card"
          aria-expanded={open}
          data-testid="credit-toggle"
          onClick={() => setOpen(!open)}
        >
          <span class="credit__top">
            {line}
            <span class={`credit__chev${open ? ' is-open' : ''}`} aria-hidden="true">
              <IconChevronRight size={18} />
            </span>
          </span>
          <span
            class="credit__bar"
            role="img"
            aria-label={`Owed by age: ${live.map((b) => `${b.label} ${plain(b.amount)}`).join(', ')}`}
            data-testid="credit-age-bar"
          >
            {live.map((b) => (
              <span key={b.id} class={`credit__seg credit__seg--${b.id}`} style={{ flexGrow: b.amount }} data-bucket={b.id} />
            ))}
          </span>
          <span class="credit__legend" data-testid="credit-legend">
            {live.map((b) => (
              <span class="credit__key" key={b.id} data-testid={`credit-key-${b.id}`} data-amount={b.amount}>
                <i class={`credit__swatch credit__seg--${b.id}`} aria-hidden="true" />
                {b.label} <b>{plain(b.amount)}</b>
              </span>
            ))}
          </span>
        </button>
      )}

      {open && !settled ? (
        <div class="credit__people" data-testid="credit-people">
          {book.people.map((p) => {
            const on = openKey === p.key;
            return (
              <div class="credit__person" key={p.key}>
                <button
                  type="button"
                  class="credit__main"
                  aria-expanded={on}
                  data-testid={`credit-person-${p.key}`}
                  onClick={() => setOpenKey(on ? null : p.key)}
                >
                  <span class="credit__name">{p.name}</span>
                  <span class="credit__meta">
                    <Money value={p.owed} /> · {p.ageLabel}
                  </span>
                </button>
                <span class="credit__actions">
                  {p.whatsapp ? (
                    <a
                      class="credit__pill"
                      href={p.whatsapp}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid={`credit-whatsapp-${p.key}`}
                    >
                      WhatsApp
                    </a>
                  ) : null}
                  {p.phone ? (
                    <button
                      type="button"
                      class="credit__pill"
                      data-testid={`credit-phone-${p.key}`}
                      onClick={() => copyPhone(p.phone)}
                    >
                      Copy phone
                    </button>
                  ) : null}
                </span>
                {on ? (
                  <div class="credit__orders" data-testid={`credit-orders-${p.key}`}>
                    {p.orders.map((o) => (
                      <div class="credit__order" key={o.id} data-testid={`credit-order-${o.id}`}>
                        <span class="credit__order-main">
                          <span class="credit__order-date">{dayLabel(o.date)}</span>
                          <span class="credit__meta">
                            <Money value={o.balance} />
                            {o.paid > 0 ? ` left of ${plain(o.total)}` : ''}
                          </span>
                        </span>
                        <button
                          type="button"
                          class="credit__pill"
                          data-testid={`credit-settle-order-${o.id}`}
                          onClick={() => begin(p, o)}
                        >
                          Settle
                        </button>
                      </div>
                    ))}
                    {p.orders.length > 1 ? (
                      <Button size="md" data-testid={`credit-settle-all-${p.key}`} onClick={() => begin(p, null)}>
                        Settle all {formatUGX(p.owed)}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <Sheet
        open={!!target}
        title={
          target
            ? target.order
              ? `Settle · ${target.person.name} · ${dayLabel(target.order.date)}`
              : `Settle · ${target.person.name}`
            : 'Settle'
        }
        onClose={() => setTarget(null)}
      >
        {target ? (
          <div class="credit__settle" data-testid="credit-settle-sheet">
            <p class="credit__owes">
              Owes <Money className="v-money--total" value={targetOwed} />
            </p>
            <Field
              label="Amount (UGX)"
              inputMode="numeric"
              data-testid="credit-settle-amount"
              value={amount}
              onInput={(e) => setAmount((e.target as HTMLInputElement).value)}
            />
            <Field
              label="Note"
              value={note}
              placeholder="Optional"
              onInput={(e) => setNote((e.target as HTMLInputElement).value)}
            />
            <Button
              size="lg"
              data-testid="credit-settle-confirm"
              disabled={busy || targetOwed <= 0}
              onClick={() => void settle()}
            >
              {busy ? 'Saving…' : 'Record payment'}
            </Button>
          </div>
        ) : null}
      </Sheet>
    </section>
  );
}

