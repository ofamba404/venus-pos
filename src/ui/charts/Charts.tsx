import type { ComponentChildren } from 'preact';

type Point = { label: string; value: number };

function linePoints(values: number[], width: number, height: number) {
  const max = Math.max(1, ...values);
  const last = Math.max(1, values.length - 1);
  return values.map((value, index) => {
    const x = (index / last) * width;
    const y = height - (value / max) * (height - 10) - 4;
    return { x, y };
  });
}

/** Revenue as an area, profit as a line on top of it. */
export function AreaChart({
  points,
  profit,
  testId,
  caption,
  onOpen,
}: {
  points: Point[];
  profit?: number[];
  testId?: string;
  caption: string;
  onOpen: () => void;
}) {
  const width = 320;
  const height = 128;
  const revenue = points.map((point) => point.value);
  const coords = linePoints(revenue.length ? revenue : [0], width, height);
  const area = [`0,${height}`, ...coords.map((p) => `${p.x},${p.y}`), `${width},${height}`].join(' ');
  const revenuePath = coords.map((p, index) => `${index ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  const profitCoords = linePoints(profit && profit.length ? profit : revenue.map(() => 0), width, height);
  const profitPath = profitCoords.map((p, index) => `${index ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  const peak = points.reduce((best, point) => (point.value > best.value ? point : best), points[0] || { label: '—', value: 0 });
  return (
    <button
      type="button"
      class="chart-card"
      data-testid={testId}
      aria-label={`Revenue trend. Peak ${peak.label}. ${caption}`}
      onClick={onOpen}
    >
      <span class="chart-card__title">Revenue</span>
      <svg class="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img">
        <polygon class="chart-area" points={area} />
        <path class="chart-line" pathLength="1" d={revenuePath} />
        {profit ? <path class="chart-line chart-line--profit" pathLength="1" d={profitPath} /> : null}
      </svg>
      <span class="chart-legend">
        <i class="chart-legend__swatch" /> Revenue
        <i class="chart-legend__swatch chart-legend__swatch--profit" /> Profit
      </span>
      <span class="chart-card__caption">{caption}</span>
    </button>
  );
}

/** Horizontal bars. The length is the comparison. The number sits at the end. */
export function BarChart({
  title,
  rows,
  testId,
  onOpen,
}: {
  title: string;
  rows: Array<{ id: string; label: string; value: number; color?: string; note?: string }>;
  testId?: string;
  onOpen: () => void;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  const lead = rows[0];
  return (
    <button
      type="button"
      class="chart-card"
      data-testid={testId}
      aria-label={lead ? `${title}. ${lead.label} leads.` : title}
      onClick={onOpen}
    >
      <span class="chart-card__title">{title}</span>
      <span class="v-bars">
        {rows.map((row) => (
          <span class="v-bars__row" key={row.id}>
            <span class="v-bars__label">{row.label}</span>
            <span class="v-bars__track">
              <span style={{ width: `${(row.value / max) * 100}%`, background: row.color || 'var(--accent)' }} />
            </span>
            <span class="v-bars__val">{row.note || row.value}</span>
          </span>
        ))}
        {!rows.length ? <span class="chart-card__caption">Nothing in this range</span> : null}
      </span>
    </button>
  );
}

function paint(color: string) {
  const value = color.trim().toLowerCase();
  if (value === '#fff' || value === '#ffffff') return 'var(--plain)';
  return color;
}

/** Flavour share as a donut in the flavour colours. */
export function Donut({
  slices,
  onOpen,
}: {
  slices: Array<{ id: string; name: string; color: string; value: number }>;
  onOpen: () => void;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0) || 1;
  const radius = 42;
  const turn = 2 * Math.PI * radius;
  let cursor = 0;
  const lead = slices[0];
  return (
    <button
      type="button"
      class="chart-card"
      aria-label={lead ? `Flavour mix. ${lead.name} is the largest.` : 'Flavour mix'}
      onClick={onOpen}
    >
      <span class="chart-card__title">Flavour mix</span>
      <span class="donut">
        <svg class="chart-svg" viewBox="0 0 120 120" role="img">
          <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--paper-100)" stroke-width="16" />
          {slices.slice(0, 8).map((slice) => {
            const length = (slice.value / total) * turn;
            const node = (
              <circle
                key={slice.id}
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke={paint(slice.color)}
                stroke-width="16"
                stroke-dasharray={`${length} ${turn - length}`}
                stroke-dashoffset={-cursor}
                transform="rotate(-90 60 60)"
                class="chart-slice"
              />
            );
            cursor += length;
            return node;
          })}
        </svg>
        <span class="donut__center">{lead ? lead.name : '—'}</span>
      </span>
      <span class="chart-card__caption">{lead ? `${lead.value} of ${total}` : 'No flavours yet'}</span>
    </button>
  );
}

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Peak hours as a grid. Darker means busier. */
export function Heatmap({
  heat,
  heatMax,
  caption,
  onOpen,
}: {
  heat: number[][];
  heatMax: number;
  caption: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      class="chart-card"
      data-testid="insights-heatmap"
      aria-label={caption}
      onClick={onOpen}
    >
      <span class="chart-card__title">Peak hours</span>
      <span class="v-heat" aria-hidden="true">
        {heat.map((row, day) => (
          <span class="v-heat__row" key={DAYS[day]}>
            <span class="v-heat__day">{DAYS[day]}</span>
            {row.slice(8, 22).map((value, hour) => (
              <span
                key={`${day}-${hour}`}
                class="v-heat__cell"
                style={{
                  opacity: Math.max(0.08, value / Math.max(1, heatMax)),
                  animationDelay: `${Math.min(day * 14 + hour, 40) * 12}ms`,
                }}
              />
            ))}
          </span>
        ))}
      </span>
      <span class="chart-card__caption">{caption}</span>
    </button>
  );
}

/** One batch, drawn as how full it is. */
export function Ring({ value, max, center }: { value: number; max: number; center: string }) {
  const radius = 36;
  const turn = 2 * Math.PI * radius;
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  return (
    <svg class="ring chart-svg" viewBox="0 0 96 96" role="img" aria-hidden="true">
      <circle cx="48" cy="48" r={radius} fill="none" stroke="var(--paper-100)" stroke-width="8" />
      <circle
        cx="48"
        cy="48"
        r={radius}
        fill="none"
        stroke="var(--accent)"
        stroke-width="8"
        stroke-linecap="round"
        stroke-dasharray={`${pct * turn} ${turn}`}
        transform="rotate(-90 48 48)"
        class="chart-slice"
      />
      <text x="48" y="53" text-anchor="middle" class="ring__text">
        {center}
      </text>
    </svg>
  );
}

export function ChartCard({
  title,
  testId,
  label,
  onOpen,
  children,
}: {
  title: string;
  testId?: string;
  label: string;
  onOpen: () => void;
  children: ComponentChildren;
}) {
  return (
    <button type="button" class="chart-card" data-testid={testId} aria-label={label} onClick={onOpen}>
      <span class="chart-card__title">{title}</span>
      {children}
    </button>
  );
}
