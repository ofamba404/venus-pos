export function FlavorDot({
  color,
  hollow = false,
  size = 'md',
}: {
  color: string;
  hollow?: boolean;
  size?: 'md' | 'lg';
}) {
  return (
    <span
      class={`v-flavor ${hollow ? 'v-flavor--hollow' : ''} ${size === 'lg' ? 'v-flavor--lg' : ''}`.trim()}
      style={{ '--flavor': color } as Record<string, string>}
      aria-hidden="true"
    />
  );
}
