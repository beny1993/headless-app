import { describe, expect, it, vi } from 'vitest';

// The auth module builds Better Auth at import time and reads env + the db
// handle while doing it. Neither is needed to inspect the resulting config.
vi.mock('@/db', () => ({ db: {} }));
vi.stubEnv('APP_CONFIG_AUTH_SECRET', 'test-secret');

const { auth } = await import('./index');

describe('better auth user config', () => {
  // Third leg of the role default: the schema column and UserDao are covered in
  // UserDao.test.ts, but Better Auth writes `role` itself on the accounts it
  // creates, and its own default would win over the column's.
  const role = auth.options.user?.additionalFields?.role;

  it('defaults a Better-Auth-created user to customer, never admin', () => {
    expect(role?.defaultValue).toBe('customer');
    expect(role?.defaultValue).not.toBe('admin');
  });

  it('refuses client-supplied roles', () => {
    // Without `input: false` a sign-up payload could name its own role.
    expect(role?.input).toBe(false);
  });
});
