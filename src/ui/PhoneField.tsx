import { localPhoneDigits } from '../domain/phone';

/** Uganda's country code. It is a fixed segment, never typed and never copied. */
export const COUNTRY_CODE = '+256';

/** A phone as the box shows it: the country code on its own, then the national number. */
export function splitPhone(raw: string | null | undefined): { cc: string; national: string } {
  const text = String(raw || '').trim();
  if (/^\+(?!256)\d/.test(text)) return { cc: '', national: text };
  return { cc: COUNTRY_CODE, national: localPhoneDigits(text) };
}

/**
 * An editable phone: a fixed "+256" segment, then the 9-digit national number. Paste or type any format
 * (+256700…, 0700…, 700…) and it settles to the national digits. The value handed back is "+256" and the digits,
 * or empty, the form the store records as phone_e164.
 */
export function PhoneField({
  label = 'Phone',
  value,
  onChange,
  testId,
}: {
  label?: string;
  value: string;
  onChange: (e164: string) => void;
  testId?: string;
}) {
  const national = localPhoneDigits(value).slice(0, 9);
  return (
    <label class="v-field">
      <span class="v-field__label">{label}</span>
      <span class="v-phone">
        <span class="v-phone__cc" data-testid={testId ? `${testId}-cc` : undefined}>
          {COUNTRY_CODE}
        </span>
        <input
          class="v-phone__input"
          type="tel"
          inputMode="numeric"
          autocomplete="tel-national"
          placeholder="700 000 000"
          data-testid={testId}
          value={national}
          onInput={(e) => {
            const digits = localPhoneDigits((e.target as HTMLInputElement).value).slice(0, 9);
            (e.target as HTMLInputElement).value = digits;
            onChange(digits ? `${COUNTRY_CODE}${digits}` : '');
          }}
        />
      </span>
    </label>
  );
}

/** The read-only phone: the same two segments, not editable. */
export function ReadPhone({ label = 'Phone', value, testId, copy }: { label?: string; value: string; testId: string; copy?: preact.ComponentChildren }) {
  const { cc, national } = splitPhone(value);
  return (
    <div class="v-field v-so-field" data-testid={testId}>
      <span class="v-field__label">{label}</span>
      <div class="v-so-field__row">
        <div class="v-phone v-phone--ro" data-testid={`${testId}-box`} aria-readonly="true">
          {cc ? (
            <span class="v-phone__cc" data-testid={`${testId}-cc`}>
              {cc}
            </span>
          ) : null}
          <span class="v-phone__number" data-testid={`${testId}-value`}>
            {national}
          </span>
        </div>
        {copy}
      </div>
    </div>
  );
}
