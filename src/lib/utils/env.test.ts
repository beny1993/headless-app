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

describe('getEnvFlag', () => {
  const FLAG = 'APP_CONFIG_MAINTENANCE_MODE';

  it.each([
    ['true', true],
    [' true ', true],
    ['false', false],
    ['', false],
    [undefined, false],
    ['TRUE', false],
    ['1', false],
  ])('reads %j as %s', async (value, expected) => {
    const { getEnvFlag, VARS } = await loadEnv({ [FLAG]: value });
    expect(getEnvFlag(VARS.APP_CONFIG_MAINTENANCE_MODE)).toBe(expected);
  });
});

describe('getEnvProvider', () => {
  const KEY = 'APP_CONFIG_STORAGE_PROVIDER';
  const PROVIDERS = ['local', 's3'] as const;

  it.each([
    [undefined, 'local'],
    ['', 'local'],
    ['   ', 'local'],
    ['s3', 's3'],
    ['  s3  ', 's3'],
  ])('reads %j as %j', async (value, expected) => {
    const { getEnvProvider, VARS } = await loadEnv({ [KEY]: value });
    expect(
      getEnvProvider(VARS.APP_CONFIG_STORAGE_PROVIDER, PROVIDERS, 'local'),
    ).toBe(expected);
  });

  it.each(['gcs', 'constructor', 'toString', 'S3'])(
    'refuses %j with the variable, the value and the known providers',
    async (value) => {
      const { getEnvProvider, VARS } = await loadEnv({ [KEY]: value });
      expect(() =>
        getEnvProvider(VARS.APP_CONFIG_STORAGE_PROVIDER, PROVIDERS, 'local'),
      ).toThrow(`${KEY}="${value}" has no driver. Known providers: local, s3.`);
    },
  );
});
