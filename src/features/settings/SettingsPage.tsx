import { useState } from 'preact/hooks';
import { enablePush } from '../../data/push';
import { runNotificationCheck, type CheckLine } from '../../data/push-check';
import { KEYS } from '../../data/keys';
import { allowDevBypass, authRole, authSession, signOut } from '../../data/auth';
import { Button } from '../../ui/Button';
import { showToast } from '../../ui/ToastHost';
import { INSTALL_STEPS } from '../../domain/parity';

function readJson(key: string) {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    return {};
  }
}

export function SettingsPage() {
  const [prefs, setPrefs] = useState(() => readJson(KEYS.uiPrefs));
  const [notif, setNotif] = useState(() => ({
    orders: true,
    stock: true,
    ...readJson(KEYS.notifPrefs),
  }));
  const [checking, setChecking] = useState(false);
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
          <div class="v-muted" style={{ color: 'var(--fg-2)' }}>
            Role: {authRole.value || 'none'}
          </div>
        </div>
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
        <div class="v-muted">
          Enable asks the browser once, then registers this phone for order alerts. The original
          register at / keeps its own alerts.
        </div>
        <div class="v-muted" data-testid="install-steps">
          {INSTALL_STEPS.join(' ')}
        </div>
        <div class="v-muted">Build {typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'}</div>
        <Button variant="danger" data-testid="sign-out" onClick={logout}>
          Sign out
        </Button>
      </div>
    </section>
  );
}

declare const __BUILD_ID__: string;
