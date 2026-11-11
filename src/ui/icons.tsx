import type { JSX } from 'preact';

type IconProps = JSX.SVGAttributes<SVGSVGElement> & { size?: number };

function base({ size = 24, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.75,
    'stroke-linecap': 'round' as const,
    'stroke-linejoin': 'round' as const,
    ...rest,
  };
}

export function IconSell(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 7.5 12 3l8 4.5V18l-8 4-8-4V7.5Z" />
      <path d="M12 11v7" />
    </svg>
  );
}

export function IconOrders(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M7 7h10l1 13H6L7 7Z" />
      <path d="M9 7a3 3 0 0 1 6 0" />
    </svg>
  );
}

export function IconStock(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6 9h12v10H6z" />
      <path d="M8 6h8v3H8z" />
      <path d="M9 13h6" />
    </svg>
  );
}

export function IconMore(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconInsights(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 17 10 11l4 4 6-8" />
      <circle cx="20" cy="7" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconClose(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function IconPlus(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconMinus(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M5 12h14" />
    </svg>
  );
}

export function IconCheck(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M5 12.5 10 17l9-10" />
    </svg>
  );
}

export function IconChevronLeft(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M15 5 8 12l7 7" />
    </svg>
  );
}

export function IconUser(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 19c1.5-3 4-4.5 7-4.5S17.5 16 19 19" />
    </svg>
  );
}

export function IconSync(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M20 12a8 8 0 1 1-2.2-5.5" />
      <path d="M20 5v5h-5" />
    </svg>
  );
}
