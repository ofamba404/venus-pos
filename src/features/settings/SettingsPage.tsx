import { KEYS } from '../../data/keys';
import { allowDevBypass, authRole, authSession, signOut } from '../../data/auth';
import { Button } from '../../ui/Button';
import { showToast } from '../../ui/ToastHost';

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.uiPrefs) || '{}');
  } catch {
    return {};
  }
}

export function SettingsPage() {
  const prefs = readPrefs();
  const haptics = prefs.haptics !== false;

  function toggleHaptics() {
    const next = { ...prefs, haptics: !haptics };
    localStorage.setItem(KEYS.uiPrefs, JSON.stringify(next));
    showToast(next.haptics ? 'Haptics on' : 'Haptics off');
  }

  function logout() {
    signOut();
    showToast('Signed out');
    if (!allowDevBypass()) {
      location.replace('/auth.html?next=' + encodeURIComponent('/next/sell'));
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
        <div class="v-muted">Build {typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'}</div>
        <Button variant="danger" onClick={logout}>
          Sign out
        </Button>
      </div>
    </section>
  );
}

declare const __BUILD_ID__: string;
