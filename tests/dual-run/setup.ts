/**
 * Dual-run setup: stub browser globals so legacy ESM modules can load in Vitest.
 * Domain/unit tests ignore these stubs.
 */
import { beforeAll } from 'vitest';

beforeAll(() => {
  const g = globalThis as typeof globalThis & {
    window?: Window & typeof globalThis;
    document?: Document;
    localStorage?: Storage;
    sessionStorage?: Storage;
    matchMedia?: (q: string) => MediaQueryList;
    VenusPosAuth?: Record<string, unknown>;
    VENUS_POS?: Record<string, unknown>;
  };

  if (typeof g.window === 'undefined') {
    // jsdom environment for dual-run files sets these; node env unit tests may not.
    g.window = g as unknown as Window & typeof globalThis;
  }

  if (typeof g.matchMedia !== 'function') {
    g.matchMedia = () =>
      ({
        matches: false,
        media: '',
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return false;
        },
      }) as MediaQueryList;
  }

  if (!g.VenusPosAuth) {
    g.VenusPosAuth = {
      getRole: () => 'pos_admin',
      canAccessPage: () => true,
      getAccessToken: () => null,
      isAdmin: () => true,
    };
  }

  if (!g.VENUS_POS) {
    g.VENUS_POS = {
      roles: { admin: 'pos_admin', staff: 'pos_staff' },
      storageKey: 'venus-pos-auth',
    };
  }
});
