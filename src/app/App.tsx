export function App() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
        background: '#f5f4f1',
        color: '#212121',
      }}
    >
      <p style={{ fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6b7280' }}>
        Venus POS v2
      </p>
      <h1 style={{ fontSize: 22, fontWeight: 600, margin: '8px 0' }}>Overhaul in progress</h1>
      <p style={{ color: '#575757', maxWidth: 420 }}>
        Domain ports and the test harness are landing first. Sell, Orders, and Stock screens arrive in
        Phases 4–6. Build{' '}
        <code>{typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'}</code>.
      </p>
    </main>
  );
}

declare const __BUILD_ID__: string;
