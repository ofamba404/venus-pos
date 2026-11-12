import type { ComponentChildren } from 'preact';

function Spark({ values }: { values: number[] }) {
  const nums = values.length ? values : [0];
  const max = Math.max(1, ...nums);
  const width = 72;
  const height = 28;
  const last = Math.max(1, nums.length - 1);
  const d = nums
    .map((value, index) => {
      const x = (index / last) * width;
      const y = height - (value / max) * (height - 4) - 2;
      return `${index ? 'L' : 'M'}${x} ${y}`;
    })
    .join(' ');
  return (
    <svg class="kpi-spark chart-svg" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path class="chart-line" pathLength="1" d={d} />
    </svg>
  );
}

/** A number, the change, and the shape of that change. */
export function KpiTile({
  label,
  children,
  trend,
  spark,
  testId,
  revenue,
  joints,
  owed,
  onOpen,
}: {
  label: string;
  children: ComponentChildren;
  trend?: { text: string; tone: 'up' | 'down' | 'neutral' };
  spark?: number[];
  testId?: string;
  revenue?: number;
  joints?: number;
  owed?: number;
  onOpen?: () => void;
}) {
  const marks: Record<string, number> = {};
  if (revenue !== undefined) marks['data-revenue'] = revenue;
  if (joints !== undefined) marks['data-joints'] = joints;
  if (owed !== undefined) marks['data-owed'] = owed;
  const Tag = onOpen ? 'button' : 'div';
  return (
    <Tag type={onOpen ? 'button' : undefined} class="v-stat kpi-tile" data-testid={testId} {...marks} onClick={onOpen}>
      <div class="kpi-tile__top">
        <div>
          <div class="v-stat__label">{label}</div>
          <div class="v-stat__value">{children}</div>
        </div>
        {spark ? <Spark values={spark} /> : null}
      </div>
      {trend ? <div class={`kpi-tile__trend kpi-tile__trend--${trend.tone}`}>{trend.text}</div> : null}
    </Tag>
  );
}
