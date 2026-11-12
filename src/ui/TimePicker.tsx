/** Kampala wall time, as a clock the cashier sets, not an ISO string they edit. */
export function TimePicker({
  label = 'Deliver at',
  value,
  testId = 'delivery-at',
  onChange,
}: {
  label?: string;
  value: string;
  testId?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label class="v-field time-picker">
      <span class="v-field__label">{label}</span>
      <input
        class="v-field__input"
        type="datetime-local"
        data-testid={testId}
        value={value}
        onInput={(event) => onChange((event.target as HTMLInputElement).value)}
      />
    </label>
  );
}
