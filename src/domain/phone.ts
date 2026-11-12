/** 9-digit Uganda local number. Drops +256 and a leading 0. */
export function localPhoneDigits(raw: string | null | undefined): string {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('256')) digits = digits.slice(3);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}
