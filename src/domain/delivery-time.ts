/** A short time for a store-order card: "Right now" for ASAP, otherwise a clock like "4:30 PM". */
export function deliveryTimePill(delivery?: { mode?: string; label?: string; deliverAt?: string } | null): string {
  if (!delivery) return '';
  const mode = String(delivery.mode || '').trim().toLowerCase();
  const label = String(delivery.label || '').trim();
  const at = String(delivery.deliverAt || '').trim();
  if (mode === 'asap' || /^(asap|right now|now)$/i.test(label) || /\basap\b/i.test(label)) {
    return 'Right now';
  }
  if (at) {
    const date = new Date(at);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleTimeString('en-US', {
        timeZone: 'Africa/Kampala',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    }
  }
  return label;
}
