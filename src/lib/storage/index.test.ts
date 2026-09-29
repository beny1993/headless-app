import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStorageDriver, getStorageProvider } from './index';
import { localDriver } from './local-driver';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('getStorageProvider', () => {
  it.each(['', '   '])('defaults %j to local', (value) => {
    vi.stubEnv('APP_CONFIG_STORAGE_PROVIDER', value);
    expect(getStorageProvider()).toBe('local');
  });

  it('defaults an unset variable to local', () => {
    vi.stubEnv('APP_CONFIG_STORAGE_PROVIDER', undefined);
    expect(getStorageProvider()).toBe('local');
  });

  it('reads a padded s3', () => {
    vi.stubEnv('APP_CONFIG_STORAGE_PROVIDER', ' s3 ');
    expect(getStorageProvider()).toBe('s3');
  });

  it.each(['gcs', 'constructor'])('refuses %j, naming it', (value) => {
    vi.stubEnv('APP_CONFIG_STORAGE_PROVIDER', value);
    expect(() => getStorageDriver()).toThrow(
      `APP_CONFIG_STORAGE_PROVIDER="${value}" has no driver. Known providers: local, s3.`,
    );
  });

  it('hands out the local driver by default', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('APP_CONFIG_STORAGE_PROVIDER', '');
    expect(getStorageDriver()).toBe(localDriver);
  });
});
