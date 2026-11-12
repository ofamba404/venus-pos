import { render } from 'preact';
import { useState } from 'preact/hooks';
import { hydrateAuth, signIn } from './data/auth';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './ui/ui.css';

function AuthPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  hydrateAuth();

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      try {
        sessionStorage.removeItem('venus-signed-out');
      } catch {
        /* private mode */
      }
      await signIn(email.trim(), password);
      const params = new URLSearchParams(location.search);
      const next = params.get('next') || '/next/sell';
      location.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'var(--bg)',
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: 'min(400px, 100%)',
          background: 'var(--surface)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'inset 0 0 0 1px var(--line)',
          padding: 24,
          display: 'grid',
          gap: 16,
        }}
      >
        <div>
          <div style={{ font: 'var(--t-mono-micro)', letterSpacing: '0.06em', color: 'var(--fg-3)' }}>
            VENUS POS
          </div>
          <h1 style={{ font: 'var(--t-title)', margin: '8px 0 0' }}>Sign in</h1>
        </div>
        <Field
          label="Email"
          type="email"
          autocomplete="username"
          value={email}
          onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
          required
        />
        <Field
          label="Password"
          type="password"
          autocomplete="current-password"
          value={password}
          onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
          required
          error={error}
        />
        <Button size="xl" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}

const root = document.getElementById('app');
if (root) render(<AuthPage />, root);
