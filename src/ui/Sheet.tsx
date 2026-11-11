import type { ComponentChildren } from 'preact';
import { IconClose } from './icons';

export function Sheet({
  open,
  title,
  children,
  footer,
  onClose,
  dismissible = true,
}: {
  open: boolean;
  title: string;
  children: ComponentChildren;
  footer?: ComponentChildren;
  onClose: () => void;
  dismissible?: boolean;
}) {
  if (!open) return null;
  return (
    <>
      <div
        class="v-sheet-scrim"
        onClick={() => {
          if (dismissible) onClose();
        }}
      />
      <div class="v-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div class="v-sheet__handle" />
        <div class="v-sheet__head">
          <h2 class="v-sheet__title">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        <div class="v-sheet__body">{children}</div>
        {footer ? <div class="v-sheet__foot">{footer}</div> : null}
      </div>
    </>
  );
}
