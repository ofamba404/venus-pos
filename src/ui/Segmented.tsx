export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ id: T; label: string; /** Small count after the label. Hidden at 0. */ count?: number }>;
  onChange: (id: T) => void;
}) {
  return (
    <div class="v-seg" role="tablist">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          role="tab"
          aria-selected={value === opt.id}
          class={`v-seg__btn ${value === opt.id ? 'is-on' : ''}`}
          onClick={() => onChange(opt.id)}
        >
          {opt.label}
          {opt.count ? (
            <span class="v-seg__count" data-testid={`seg-count-${opt.id}`}>
              {opt.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
