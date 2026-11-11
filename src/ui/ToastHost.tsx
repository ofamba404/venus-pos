import { signal } from '@preact/signals';

type Toast = { id: number; message: string; actionLabel?: string; onAction?: () => void };

const toasts = signal<Toast[]>([]);
let seq = 0;

export function showToast(message: string, opts?: { actionLabel?: string; onAction?: () => void; ms?: number }) {
  const id = ++seq;
  toasts.value = [...toasts.value, { id, message, actionLabel: opts?.actionLabel, onAction: opts?.onAction }];
  window.setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, opts?.ms ?? 4000);
}

export function ToastHost() {
  if (!toasts.value.length) return null;
  const t = toasts.value[toasts.value.length - 1]!;
  return (
    <div class="v-toast-host" role="status">
      <div class="v-toast">
        <span>{t.message}</span>
        {t.actionLabel ? (
          <button
            type="button"
            onClick={() => {
              t.onAction?.();
              toasts.value = toasts.value.filter((x) => x.id !== t.id);
            }}
          >
            {t.actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
