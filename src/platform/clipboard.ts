import { showToast } from '../ui/ToastHost';

/** Copy text and say so. Falls back to showing the text when the browser refuses. */
export async function copyText(
  text: string,
  ok: string,
  empty = 'Nothing to copy',
  /** A button that shows its own tick says nothing on success. Failures still speak. */
  quiet = false,
): Promise<boolean> {
  const value = text.trim();
  if (!value) {
    showToast(empty);
    return false;
  }
  try {
    await navigator.clipboard.writeText(value);
    if (!quiet) showToast(ok);
    return true;
  } catch {
    showToast(value);
    return false;
  }
}
