import type { ComponentChildren } from 'preact';

/** A number with a reason to care. The trend is yesterday, not a second heading. */
export function KpiTile({
  label,
  children,
  trend,
  testId,
  revenue,
  joints,
  owed,
}: {
  label: string;
  children: ComponentChildren;
  trend?: { text: string; tone: 'up' | 'down' | 'neutral' };
  testId?: string;
  revenue?: number;
  joints?: number;
  owed?: number;
}) {
  const marks: Record<string, number> = {};
  if (revenue !== undefined) marks['data-revenue'] = revenue;
  if (joints !== undefined) marks['data-joints'] = joints;
  if (owed !== undefined) marks['data-owed'] = owed;
  return (
    <div class="v-stat kpi-tile" data-testid={testId} {...marks}>
      <div class="v-stat__label">{label}</div>
      <div class="v-stat__value">{children}</div>
      {trend ? <div class={`kpi-tile__trend kpi-tile__trend--${trend.tone}`}>{trend.text}</div> : null}
    </div>
  );
}
