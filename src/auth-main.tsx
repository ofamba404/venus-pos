import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  authErrorMessage,
  hydrateAuth,
  recoverySessionFromHash,
  requestPasswordReset,
  signIn,
  updatePassword,
  type AuthSession,
} from './data/auth';
import { Button } from './ui/Button';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './ui/ui.css';

type Mode = 'login' | 'forgot' | 'reset';

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function nextHref() {
  const next = new URLSearchParams(location.search).get('next') || '/next/sell';
  if (next.includes('://') || next.startsWith('//') || next.includes('..')) return '/next/sell';
  return next;
}

function AuthPage() {
  const recovery = recoverySessionFromHash(location.hash);
  const [mode, setMode] = useState<Mode>(recovery ? 'reset' : 'login');
  const [recoverySession, setRecoverySession] = useState<AuthSession | null>(recovery);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  hydrateAuth();
  useEffect(() => {
    if (!recovery) return;
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  }, []);

  function fail(err: unknown, fallback: string) {
    const message = err instanceof Error ? err.message : '';
    setError(authErrorMessage(message) || message || fallback);
    setBusy(false);
  }

  async function submitLogin(event: Event) {
    event.preventDefault();
    setError('');
    setNote('');
    if (!EMAIL_OK.test(email.trim()) || !password) {
      setError('Enter the email and password for your Venus account.');
      return;
    }
    setBusy(true);
    try {
      try {
        sessionStorage.removeItem('venus-signed-out');
      } catch {
        /* private mode */
      }
      await signIn(email.trim(), password);
      location.replace(nextHref());
    } catch (err) {
      fail(err, 'Could not sign in. Try again.');
    }
  }

  async function submitForgot(event: Event) {
    event.preventDefault();
    setError('');
    setNote('');
    if (!EMAIL_OK.test(email.trim())) {
      setError('Enter the email you use to sign in.');
      return;
    }
    setBusy(true);
    try {
      const redirectTo = new URL('auth.html', location.href).href;
      await requestPasswordReset(email.trim(), redirectTo);
      setNote('If that email has a register account, a reset link is on its way. Open it on this phone.');
      setBusy(false);
    } catch (err) {
      fail(err, 'Could not send the reset link. Try again.');
    }
  }

  async function submitReset(event: Event) {
    event.preventDefault();
    setError('');
    setNote('');
    if (password.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Those passwords do not match.');
      return;
    }
    const token = recoverySession?.access_token;
    if (!token) {
      setError('This reset link has expired. Request a new one.');
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password, token);
      setPassword('');
      setConfirm('');
      setRecoverySession(null);
      setMode('login');
      setNote('Password updated. Sign in with the new one.');
      setBusy(false);
    } catch (err) {
      fail(err, 'Could not update the password. Try again.');
    }
  }

  const title = mode === 'forgot' ? 'Reset password' : mode === 'reset' ? 'Choose a new password' : 'Sign in';
  const submit = mode === 'forgot' ? submitForgot : mode === 'reset' ? submitReset : submitLogin;

  return (
    <main class="auth">
      <section class="auth-card v-page" aria-labelledby="auth-title">
        <img class="auth-logo" src={`${import.meta.env.BASE_URL}assets/logo.svg`} alt="" width="56" height="56" />
        <p class="auth-kicker">Venus</p>
        <h1 id="auth-title" class="auth-title">{title}</h1>
        <p class="auth-sub">
          {mode === 'login'
            ? 'The register for the Venus team.'
            : mode === 'forgot'
              ? 'We will email you a link to set a new password.'
              : 'At least 8 characters. Then sign in as usual.'}
        </p>
        {error ? (
          <p class="auth-alert" role="alert">
            {error}
          </p>
        ) : null}
        {note ? (
          <p class="auth-note" role="status">
            {note}
          </p>
        ) : null}
        <form class="auth-form" onSubmit={submit} noValidate>
          {mode !== 'reset' ? (
            <label class="v-field">
              <span class="v-field__label">Email</span>
              <input
                class="v-field__input"
                type="email"
                name="email"
                inputMode="email"
                autocomplete="username"
                placeholder="you@venus.test"
                value={email}
                onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
              />
            </label>
          ) : null}
          {mode !== 'forgot' ? (
            <div class="v-field">
              <span class="v-field__label" id="auth-password-label">
                {mode === 'reset' ? 'New password' : 'Password'}
              </span>
              <span class="auth-pass">
                <input
                  class="v-field__input"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  aria-labelledby="auth-password-label"
                  autocomplete={mode === 'reset' ? 'new-password' : 'current-password'}
                  value={password}
                  onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
                />
                <button
                  class="auth-pass__toggle"
                  type="button"
                  aria-pressed={showPassword}
                  aria-label={showPassword ? 'Hide' : 'Show'}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </span>
            </div>
          ) : null}
          {mode === 'reset' ? (
            <label class="v-field">
              <span class="v-field__label">Confirm password</span>
              <input
                class="v-field__input"
                type={showPassword ? 'text' : 'password'}
                autocomplete="new-password"
                value={confirm}
                onInput={(e) => setConfirm((e.target as HTMLInputElement).value)}
              />
            </label>
          ) : null}
          <Button size="xl" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Update password' : 'Sign in'}
          </Button>
        </form>
        {mode === 'login' ? (
          <button
            class="auth-link"
            type="button"
            onClick={() => {
              setError('');
              setNote('');
              setMode('forgot');
            }}
          >
            Forgot password?
          </button>
        ) : (
          <button
            class="auth-link"
            type="button"
            onClick={() => {
              setError('');
              setMode('login');
            }}
          >
            Back to sign in
          </button>
        )}
      </section>
    </main>
  );
}

const root = document.getElementById('app');
if (root) render(<AuthPage />, root);
