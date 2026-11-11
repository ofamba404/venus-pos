import type { JSX } from 'preact';

export function Field({
  label,
  hint,
  error,
  ...input
}: {
  label: string;
  hint?: string;
  error?: string;
} & JSX.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label class="v-field">
      <span class="v-field__label">{label}</span>
      <input class="v-field__input" {...input} />
      {error ? (
        <span style={{ color: 'var(--danger)', font: 'var(--t-meta)' }}>{error}</span>
      ) : hint ? (
        <span style={{ color: 'var(--fg-3)', font: 'var(--t-meta)' }}>{hint}</span>
      ) : null}
    </label>
  );
}
