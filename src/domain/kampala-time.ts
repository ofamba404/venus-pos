/** Africa/Kampala is UTC+3 year-round. datetime-local has no zone, so we pin it. */

const KAMPALA_MS = 3 * 60 * 60 * 1000;

/** Value for `<input type="datetime-local">` in Kampala wall time. */
export function kampalaLocalInput(raw: string | null | undefined): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Date(parsed.getTime() + KAMPALA_MS).toISOString().slice(0, 16);
}

/** ISO instant for a datetime-local value that the cashier meant as Kampala time. */
export function kampalaInputToIso(local: string | null | undefined): string {
  const value = String(local || '').trim();
  if (!value) return '';
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) {
    return Number.isNaN(new Date(value).getTime()) ? '' : value;
  }
  const withSeconds = value.length === 16 ? `${value}:00` : value;
  if (Number.isNaN(new Date(`${withSeconds}+03:00`).getTime())) return '';
  return `${withSeconds}+03:00`;
}
