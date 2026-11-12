import { afterEach, describe, expect, it, vi } from 'vitest';
import { authErrorMessage, recoverySessionFromHash, requestPasswordReset } from '../../src/data/auth';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sign-in recovery', () => {
  it('turns provider errors into something a person can act on', () => {
    expect(authErrorMessage('invalid_grant')).toBe('Wrong email or password.');
    expect(authErrorMessage('too many requests', 429)).toBe('Too many attempts. Wait a minute and try again.');
    expect(authErrorMessage('Failed to fetch', 0)).toMatch(/connection/);
    expect(authErrorMessage('nope')).toBe('');
  });

  it('reads a recovery link and ignores a normal hash', () => {
    expect(recoverySessionFromHash('#access_token=abc&type=login')).toBeNull();
    expect(recoverySessionFromHash('#type=recovery&access_token=abc&refresh_token=r&expires_in=10')).toMatchObject({
      access_token: 'abc',
      refresh_token: 'r',
    });
  });

  it('asks Supabase to email a reset link', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await requestPasswordReset('owner@venus.test', 'https://pos.test/next/auth.html');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/auth/v1/recover');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('redirect_to=');
  });
});
