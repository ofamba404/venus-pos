export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ id: T; label: string }>;
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
        </button>
      ))}
    </div>
  );
}
