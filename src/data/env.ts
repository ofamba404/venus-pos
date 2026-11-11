/** Public Supabase + Maps config (same values as legacy `js/config.js`). */
export const SUPABASE_URL = 'https://xiangrykfxlnacthjcad.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_UAR75C14ePR5_mqOez4wjg_mqdlnt5X';
export const SUPABASE_ANON_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpYW5ncnlrZnhsbmFjdGhqY2FkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxMjI2MDIsImV4cCI6MjA5ODY5ODYwMn0.O4IQo4aGqcSzWhE9H1szByvoblo07e7Pm3EL3v182b8';
export const GOOGLE_MAPS_API_KEY = 'AIzaSyCrCkJGwRrloiRPW3x91dvWMeVKEecKL7Y';
export const VAPID_PUBLIC_KEY =
  'BFnscOwOMzgLqNfjhxeGJ8lfii156h-gBuSbv2vMp2XBPDrv1r6DofpbGHHIzeXG7AUf2ae8Fpa42lJJcWwM6D0';

export const features = {
  paymentMethod: false,
  walkInClient: true,
  holdSale: true,
} as const;
