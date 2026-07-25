/**
 * POS auth config — same Supabase project as the storefront,
 * separate storage key so customer sessions never unlock the register.
 *
 * Roles (app_metadata.role):
 *   pos_admin — full POS (you)
 *   pos_staff — register + inventory only
 */
window.VENUS_POS = {
  url: 'https://xiangrykfxlnacthjcad.supabase.co',
  /** Legacy anon JWT — required by supabase-js Auth + Edge Functions. */
  anonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpYW5ncnlrZnhsbmFjdGhqY2FkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxMjI2MDIsImV4cCI6MjA5ODY5ODYwMn0.O4IQo4aGqcSzWhE9H1szByvoblo07e7Pm3EL3v182b8',
  storageKey: 'venus-pos-auth',
  roles: {
    admin: 'pos_admin',
    staff: 'pos_staff',
  },
  /** Pages staff may open. Admin sees every page. */
  staffPages: ['home', 'inventory'],
  authGateEnabled: true,
};
