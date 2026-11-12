import { useEffect, useRef, useState } from 'preact/hooks';
import { resolvePlace, searchPlaces, type PlaceSuggestion } from '../platform/maps';

export function PlaceSearch({
  label = 'Drop-off',
  value,
  placeholder = 'Search Kampala…',
  onPick,
}: {
  label?: string;
  value?: string;
  placeholder?: string;
  onPick: (place: { label: string; lat: number; lng: number }) => void;
}) {
  const [q, setQ] = useState(value || '');
  const [items, setItems] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);
  const typing = useRef(false);

  useEffect(() => {
    setQ(value || '');
    typing.current = false;
    setOpen(false);
    setItems([]);
  }, [value]);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (!typing.current || q.trim().length < 2) {
      setItems([]);
      setOpen(false);
      return;
    }
    timer.current = window.setTimeout(() => {
      setBusy(true);
      void searchPlaces(q)
        .then((rows) => {
          setItems(rows);
          setOpen(true);
        })
        .catch(() => setItems([]))
        .finally(() => setBusy(false));
    }, 220);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [q]);

  async function pick(row: PlaceSuggestion) {
    setBusy(true);
    try {
      const resolved = await resolvePlace(row);
      if (resolved.lat === undefined || resolved.lat === null || resolved.lng === undefined || resolved.lng === null) return;
      setQ(resolved.label);
      setOpen(false);
      onPick({ label: resolved.label, lat: resolved.lat, lng: resolved.lng });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="v-place" data-testid="place-search">
      <label class="v-field">
        <span class="v-field__label">{label}</span>
        <input
          class="v-field__input"
          data-testid="place-input"
          value={q}
          placeholder={placeholder}
          autocomplete="off"
          onInput={(e) => {
            typing.current = true;
            setQ((e.target as HTMLInputElement).value);
          }}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 180);
          }}
        />
      </label>
      {busy ? <div class="v-muted" style={{ marginTop: 4 }}>Searching…</div> : null}
      {open && items.length ? (
        <ul class="v-place__menu" role="listbox">
          {items.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                class="v-place__opt"
                role="option"
                data-testid="place-option"
                onClick={() => void pick(row)}
              >
                <span class="v-list-row__title">{row.label}</span>
                {row.secondary ? <span class="v-list-row__meta">{row.secondary}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
