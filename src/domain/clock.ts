function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** "HH:mm" (24-hour) to the 12-hour parts the wheels show. */
export function toWheelParts(value: string, fallback = '08:00') {
  const [h24, m] = (value || fallback).split(':').map((n) => Number(n) || 0) as [number, number];
  return { hour: h24 % 12 === 0 ? 12 : h24 % 12, minute: m, pm: h24 >= 12 ? 1 : 0 };
}

export function fromWheelParts(hour: number, minute: number, pm: number): string {
  const h24 = (hour % 12) + (pm ? 12 : 0);
  return `${pad(h24)}:${pad(minute)}`;
}
