import { afterEach, describe, expect, it, vi } from 'vitest';

// `STATIC_INLINED_VARS` snapshots process.env at import time, so every case has
// to stub the environment first and then re-import the module.
const loadEnv = async (vars: Record<string, string | undefined>) => {
  Object.entries(vars).forEach(([key, value]) => vi.stubEnv(key, value));
  vi.resetModules();
  return import('./env');
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('getAppBaseUrl', () => {
  it('returns the configured URL', async () => {
    const { getAppBaseUrl } = await loadEnv({
      NEXT_PUBLIC_APP_URL: 'https://smokey.example',
      NODE_ENV: 'production',
    });

    expect(getAppBaseUrl()).toBe('https://smokey.example');
  });

  it('falls back to localhost outside production', async () => {
    const { getAppBaseUrl } = await loadEnv({
      NEXT_PUBLIC_APP_URL: undefined,
      NODE_ENV: 'development',
    });

    expect(getAppBaseUrl()).toBe('http://localhost:3000');
  });

  it('refuses to fall back to localhost in production', async () => {
    // Better Auth reads this URL for its trusted origins and for the `Secure`
    // flag on the session cookie. Falling back to an http://localhost value in
    // production would ship admin sessions on a non-secure cookie, so the
    // missing variable has to fail loudly instead.
    const { getAppBaseUrl } = await loadEnv({
      NEXT_PUBLIC_APP_URL: undefined,
      NODE_ENV: 'production',
    });

    expect(() => getAppBaseUrl()).toThrow(/NEXT_PUBLIC_APP_URL/);
  });

  it('treats an empty variable as unset in production', async () => {
    const { getAppBaseUrl } = await loadEnv({
      NEXT_PUBLIC_APP_URL: '',
      NODE_ENV: 'production',
    });

    expect(() => getAppBaseUrl()).toThrow(/NEXT_PUBLIC_APP_URL/);
  });
});
