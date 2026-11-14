import { HoursSettings } from './HoursSettings';
import { useFulfillment } from './use-fulfillment';

export function StorePage() {
  const hours = useFulfillment();
  return (
    <section class="hours" data-testid="hours-page">
      <h1 class="page-title">Hours &amp; availability</h1>
      <HoursSettings hours={hours} />
    </section>
  );
}
