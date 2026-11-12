import { showToast } from '../ui/ToastHost';

/** Copy text and say so. Falls back to showing the text when the browser refuses. */
export async function copyText(text: string, ok: string, empty = 'Nothing to copy'): Promise<boolean> {
  const value = text.trim();
  if (!value) {
    showToast(empty);
    return false;
  }
  try {
    await navigator.clipboard.writeText(value);
    showToast(ok);
    return true;
  } catch {
    showToast(value);
    return false;
  }
}
