import { render } from 'preact';

function AuthPage() {
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif', color: '#212121' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>Venus POS</h1>
      <p style={{ color: '#575757' }}>Sign-in UI lands in Phase 6. Use legacy /auth.html for now.</p>
    </main>
  );
}

const root = document.getElementById('app');
if (root) render(<AuthPage />, root);
