/**
 * Order "when" label: "Today 3:40 PM", "Yesterday 9:10 AM", "Mon 19 Oct, 2:05 PM"
 * (adds the year when it isn't the current year). Device-local time, like the rest of the POS.
 */
function dayStart(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function formatOrderWhen(value, now = new Date()) {
  if (!value) return '';
  const t = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(t.getTime())) return '';
  const time = t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const diffDays = Math.round((dayStart(now) - dayStart(t)) / 86400000);
  if (diffDays === 0) return `Today ${time}`;
  if (diffDays === 1) return `Yesterday ${time}`;
  const wd = t.toLocaleDateString('en-GB', { weekday: 'short' });
  const dm = t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const yr = t.getFullYear() !== now.getFullYear() ? ` ${t.getFullYear()}` : '';
  return `${wd} ${dm}${yr}, ${time}`;
}
