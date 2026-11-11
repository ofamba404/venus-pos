import { Button } from '../../ui/Button';
import { showToast } from '../../ui/ToastHost';

export function StorePage() {
  return (
    <section>
      <h1 class="page-title">Store</h1>
      <p style={{ color: 'var(--fg-2)', maxWidth: '68ch' }}>
        Storefront users, hours dial, and admin tools from v1 admin are next to finish. Busy / open
        hours still run on the legacy surface until this panel is fully wired.
      </p>
      <div style={{ marginTop: 16 }}>
        <Button
          variant="secondary"
          onClick={() => {
            location.href = '/';
          }}
        >
          Open legacy admin
        </Button>
        <Button
          variant="ghost"
          style={{ marginLeft: 8 }}
          onClick={() => showToast('Hours controls land with fulfillment domain wiring')}
        >
          Hours
        </Button>
      </div>
    </section>
  );
}
