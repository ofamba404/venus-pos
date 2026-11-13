import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { IconClose } from './icons';
import { IconButton } from './IconButton';

/** Matches the close animation in ui.css (the store's cart drawer eases out in 480ms). */
const CLOSE_MS = 480;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Sheet / drawer. Opens and closes with the same motion as the storefront cart drawer: the panel slides in with a
 * long ease-out, the scrim fades in over 400ms, and on close the panel eases out and the scrim fades away.
 * It stays mounted while it plays the close, then unmounts. With reduced motion it just appears and disappears.
 */
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
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  // While it plays the close, keep showing what it showed when it was open, so the content does not blank mid-slide.
  const last = useRef({ title, children, footer });
  if (open) last.current = { title, children, footer };

  if (open && !mounted) setMounted(true);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (open) {
      setClosing(false);
      return;
    }
    if (!mounted) return;
    if (reducedMotion()) {
      setMounted(false);
      return;
    }
    setClosing(true);
    timer.current = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, CLOSE_MS);
    return () => window.clearTimeout(timer.current);
  }, [open, mounted]);

  if (!open && !mounted) return null;
  const out = closing && !open;
  return (
    <>
      <div
        class={`v-sheet-scrim${out ? ' is-closing' : ''}`}
        onClick={() => {
          if (dismissible && !out) onClose();
        }}
      />
      <div class={`v-sheet${out ? ' is-closing' : ''}`} role="dialog" aria-modal="true" aria-label={last.current.title}>
        <div class="v-sheet__handle" />
        <div class="v-sheet__head">
          <h2 class="v-sheet__title">{last.current.title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <IconClose size={22} />
          </IconButton>
        </div>
        <div class="v-sheet__body">{last.current.children}</div>
        {last.current.footer ? <div class="v-sheet__foot">{last.current.footer}</div> : null}
      </div>
    </>
  );
}
