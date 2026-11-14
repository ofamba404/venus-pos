import { useState } from 'preact/hooks';
import { enablePush } from '../../data/push';
import { runNotificationCheck, type CheckLine } from '../../data/push-check';
import { KEYS } from '../../data/keys';
import { allowDevBypass, authSession, changePassword, signOut } from '../../data/auth';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Sheet } from '../../ui/Sheet';
import { showToast } from '../../ui/ToastHost';

function readJson(key: string) {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    return {};
  }
}


function ChangePasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [busy, setBusy] = useState(false);

  function reset() {
    setCurrent('');
    setNext('');
    setConfirm('');
    setErrors({});
    setBusy(false);
  }

  async function save(event: Event) {
    event.preventDefault();
    const nextErrors: { current?: string; next?: string; confirm?: string } = {};
    if (next.length < 8) nextErrors.next = 'Use at least 8 characters.';
    if (next !== confirm) nextErrors.confirm = 'Those passwords do not match.';
    if (!current) nextErrors.current = 'Wrong current password.';
    setErrors(nextErrors);
    if (nextErrors.next || nextErrors.confirm || nextErrors.current) return;
    setBusy(true);
    try {
      await changePassword(current, next);
      reset();
      onClose();
      showToast('Password updated');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not update the password.';
      if (/wrong current password/i.test(message)) setErrors({ current: 'Wrong current password.' });
      else setErrors({ next: message });
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      title="Change password"
      onClose={() => {
        reset();
        onClose();
      }}
      footer={
        <Button size="xl" type="submit" form="change-password-form" loading={busy} data-testid="change-password-save">
          Save
        </Button>
      }
    >
      <form id="change-password-form" class="auth-form" onSubmit={save} noValidate>
        <Field
          label="Current password"
          type="password"
          name="current-password"
          autocomplete="current-password"
          data-testid="change-password-current"
          value={current}
          error={errors.current}
          onInput={(e) => setCurrent((e.target as HTMLInputElement).value)}
        />
        <Field
          label="New password"
          type="password"
          name="new-password"
          autocomplete="new-password"
          data-testid="change-password-new"
          value={next}
          error={errors.next}
          onInput={(e) => setNext((e.target as HTMLInputElement).value)}
        />
        <Field
          label="Confirm password"
          type="password"
          name="confirm-password"
          autocomplete="new-password"
          data-testid="change-password-confirm"
          value={confirm}
          error={errors.confirm}
          onInput={(e) => setConfirm((e.target as HTMLInputElement).value)}
        />
      </form>
    </Sheet>
  );
}

export function SettingsPage() {
  const [prefs, setPrefs] = useState(() => readJson(KEYS.uiPrefs));
  const [notif, setNotif] = useState(() => ({
    orders: true,
    stock: true,
    ...readJson(KEYS.notifPrefs),
  }));
  const [checking, setChecking] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [lines, setLines] = useState<CheckLine[]>([]);
  const haptics = prefs.haptics !== false;

  function toggleHaptics() {
    const next = { ...prefs, haptics: !haptics };
    localStorage.setItem(KEYS.uiPrefs, JSON.stringify(next));
    setPrefs(next);
    showToast(next.haptics ? 'Haptics on' : 'Haptics off');
  }

  function toggleNotif(key: 'orders' | 'stock') {
    const next = { ...notif, [key]: !notif[key] };
    localStorage.setItem(KEYS.notifPrefs, JSON.stringify(next));
    setNotif(next);
    showToast(`Notifications · ${key} ${next[key] ? 'on' : 'off'}`);
  }

  async function enableNotifications() {
    const next = { ...notif, orders: true, stock: true };
    localStorage.setItem(KEYS.notifPrefs, JSON.stringify(next));
    setNotif(next);
    const result = await enablePush({ orders: true, schedules: false });
    if (result.ok) {
      showToast('Notifications on. This phone will buzz for new orders.');
      return;
    }
    if (result.reason === 'denied') {
      showToast('Notifications are blocked in the browser. Alerts in the app stay on.');
      return;
    }
    showToast('Notifications stay on in the app. Background signup did not finish.');
  }

  async function testNotifications() {
    setChecking(true);
    setLines([]);
    try {
      await runNotificationCheck((line) => setLines((all) => [...all, line]));
    } finally {
      setChecking(false);
    }
  }

  function logout() {
    try {
      sessionStorage.setItem('venus-signed-out', '1');
    } catch {
      /* private mode */
    }
    signOut();
    showToast('Signed out');
    if (!allowDevBypass()) {
      location.replace('/next/auth.html?next=' + encodeURIComponent('/next/sell'));
    }
  }

  return (
    <section>
      <h1 class="page-title">Settings</h1>
      <div class="v-order-card" style={{ display: 'grid', gap: 12, marginBottom: 0 }}>
        <div>
          <div class="v-muted">Account</div>
          <div class="v-list-row__title">
            {authSession.value?.user?.email || (allowDevBypass() ? 'Dev session' : 'Signed in')}
          </div>
        </div>
        <button type="button" class="v-list-row" data-testid="change-password" onClick={() => setPwOpen(true)}>
          <div class="v-list-row__main">
            <div class="v-list-row__title">Change password</div>
          </div>
          <span class="v-list-row__chevron" aria-hidden="true">
            ›
          </span>
        </button>
        <Button variant="secondary" onClick={toggleHaptics}>
          Haptics: {haptics ? 'On' : 'Off'}
        </Button>
        <Button variant="secondary" data-testid="enable-notifications" onClick={enableNotifications}>
          Enable notifications
        </Button>
        <Button variant="secondary" data-testid="test-notifications" loading={checking} onClick={testNotifications}>
          Test notifications
        </Button>
        {lines.length > 0 && (
          <div data-testid="notification-check" style={{ display: 'grid', gap: 8 }}>
            {lines.map((line) => (
              <div key={line.id} data-ok={line.ok ? 'true' : 'false'}>
                <div style={{ fontSize: 13, fontWeight: 600, color: line.ok ? 'var(--success-ink)' : 'var(--danger)' }}>
                  {line.ok ? 'OK' : 'Problem'} · {line.label}
                </div>
                <div class="v-muted">{line.detail}</div>
              </div>
            ))}
          </div>
        )}
        <Button variant="secondary" onClick={() => toggleNotif('orders')}>
          Order alerts: {notif.orders ? 'On' : 'Off'}
        </Button>
        <Button variant="secondary" onClick={() => toggleNotif('stock')}>
          Stock alerts: {notif.stock ? 'On' : 'Off'}
        </Button>
        <Button variant="danger" data-testid="sign-out" onClick={logout}>
          Sign out
        </Button>
      </div>
      <ChangePasswordSheet open={pwOpen} onClose={() => setPwOpen(false)} />
    </section>
  );
}

