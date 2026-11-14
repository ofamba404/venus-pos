import { copyAllText, copyLocationText, copyPhoneText } from '../domain/delivery-copy';
import { CopyButton } from './CopyButton';

export type DeliveryCopyRowProps = {
  /** Delivery orders get Copy location and Copy all. Pickup keeps Copy phone only. */
  delivery: boolean;
  name?: string;
  phone?: string;
  place?: string;
  lat?: number | string | null;
  lng?: number | string | null;
  collect?: number | null;
  /** Read at tap time. Use for fields the cashier can still edit. */
  read?: () => Partial<Pick<DeliveryCopyRowProps, 'name' | 'phone' | 'place' | 'lat' | 'lng' | 'collect'>>;
  /** Test ids are `${prefix}phone`, `${prefix}location` and `${prefix}all`, plus the suffix. */
  idPrefix: string;
  /** Added after the kind, for lists: `copy-phone-${id}`. */
  idSuffix?: string;
  compact?: boolean;
  /** History keeps a Copy all pill. Cart and order cards do not. */
  includeAll?: boolean;
};

/** Labelled pills for pasting a delivery into SafeBoda. Shows nothing when there is nothing to copy. */
export function DeliveryCopyRow(props: DeliveryCopyRowProps) {
  const { delivery, idPrefix, idSuffix = '', compact, includeAll } = props;
  const now = () => ({ ...props, ...(props.read ? props.read() : {}) });
  const hasPhone = Boolean(copyPhoneText(props.phone) || props.read);
  const hasPlace = Boolean(String(props.place || '').trim() || props.read);
  if (!hasPhone && !(delivery && hasPlace) && !includeAll) return null;
  return (
    <div class={`v-copy-row${compact ? ' v-copy-row--compact' : ''}`} data-testid={`${idPrefix}row${idSuffix}`}>
      {hasPhone ? (
        <CopyButton
          kind="phone"
          label="Copy phone"
          compact={compact}
          testId={`${idPrefix}phone${idSuffix}`}
          value={() => copyPhoneText(now().phone)}
        />
      ) : null}
      {delivery && hasPlace ? (
        <CopyButton
          kind="place"
          label="Copy location"
          compact={compact}
          testId={`${idPrefix}location${idSuffix}`}
          value={() => copyLocationText(now())}
        />
      ) : null}
      {includeAll && delivery ? (
        <CopyButton
          kind="all"
          label="Copy all"
          compact={compact}
          testId={`${idPrefix}all${idSuffix}`}
          value={() => copyAllText(now())}
        />
      ) : null}
    </div>
  );
}
