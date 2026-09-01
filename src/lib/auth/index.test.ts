import { describe, expect, it, vi } from 'vitest';

// The auth module builds Better Auth at import time and reads env + the db
// handle while doing it. Neither is needed to inspect the resulting config.
vi.mock('@/db', () => ({ db: {} }));
vi.stubEnv('APP_CONFIG_AUTH_SECRET', 'test-secret');

const { auth } = await import('./index');

const options = auth.options;

const phonePlugin = options.plugins?.find(
  (plugin) => plugin.id === 'phone-number',
);

/** The options object the plugin was constructed with. */
const phoneOptions = (
  phonePlugin as unknown as { options?: Record<string, unknown> } | undefined
)?.options;

describe('better auth user config', () => {
  // Third leg of the role default: the schema column and UserDao are covered in
  // UserDao.test.ts, but Better Auth writes `role` itself on the accounts it
  // creates, and its own default would win over the column's.
  const role = options.user?.additionalFields?.role;

  it('defaults a Better-Auth-created user to customer, never admin', () => {
    expect(role?.defaultValue).toBe('customer');
    expect(role?.defaultValue).not.toBe('admin');
  });

  it('refuses client-supplied roles', () => {
    // Without `input: false` a sign-up payload could name its own role — and
    // `/phone-number/verify` passes arbitrary body fields to the user create.
    expect(role?.input).toBe(false);
  });
});

describe('phone number plugin', () => {
  it('is the auth method the storefront uses', () => {
    expect(phonePlugin).toBeDefined();
  });

  it('has replaced email OTP entirely', () => {
    // Keeping both would leave every customer reachable at a derived
    // `<phone>@phone.smokey.invalid` address whose sign-in code prints to the
    // server console in development.
    const ids = options.plugins?.map((plugin) => String(plugin.id)) ?? [];
    expect(ids).not.toContain('email-otp');
  });

  it('never enables password authentication', () => {
    expect(options.emailAndPassword?.enabled).toBe(false);
  });

  it('sends a six digit code that expires in two minutes', () => {
    expect(phoneOptions?.otpLength).toBe(6);
    expect(phoneOptions?.expiresIn).toBe(120);
  });

  it('gives a code three attempts before killing it', () => {
    expect(phoneOptions?.allowedAttempts).toBe(3);
  });

  it('accepts only the canonical phone form', () => {
    const validate = phoneOptions?.phoneNumberValidator as (
      value: string,
    ) => boolean;

    expect(validate('+989121234567')).toBe(true);
    // Normalizing these server-side instead would give one human two accounts.
    expect(validate('09121234567')).toBe(false);
    expect(validate('۰۹۱۲۱۲۳۴۵۶۷')).toBe(false);
    expect(validate('+14155552671')).toBe(false);
  });

  it('signs a new number up on its first verified code', () => {
    expect(phoneOptions?.signUpOnVerification).toBeDefined();
  });

  it('derives a temp email that can never receive mail', () => {
    // RFC 2606 reserves `.invalid`; a real-looking domain here would make a
    // future mailer deliverable to an address nobody controls.
    const { getTempEmail } = phoneOptions?.signUpOnVerification as {
      getTempEmail: (phone: string) => string;
    };

    expect(getTempEmail('+989121234567')).toBe(
      '989121234567@phone.smokey.invalid',
    );
  });

  it('derives a distinct temp email per number', () => {
    const { getTempEmail } = phoneOptions?.signUpOnVerification as {
      getTempEmail: (phone: string) => string;
    };

    // A collision here would join two people into one account, since `email`
    // is unique.
    expect(getTempEmail('+989121234567')).not.toBe(
      getTempEmail('+989121234568'),
    );
  });
});

describe('password endpoints', () => {
  it.each([
    '/sign-in/phone-number',
    '/phone-number/request-password-reset',
    '/phone-number/reset-password',
  ])('%s is disabled', (path) => {
    // The plugin ships these regardless of configuration. `reset-password`
    // creates a credential account, which would turn `sign-in/phone-number`
    // into a working password login.
    expect(options.disabledPaths).toContain(path);
  });
});

describe('rate limiting', () => {
  it('is on outside production too', () => {
    // Better Auth defaults this to production-only. Limits nobody meets in
    // development are limits nobody notices breaking.
    expect(options.rateLimit?.enabled).toBe(true);
  });

  it('keeps its buckets in Postgres, not in process memory', () => {
    // Memory storage empties on every PaaS redeploy and gives an attacker a
    // fresh budget per instance behind a load balancer.
    expect(options.rateLimit?.storage).toBe('database');
  });

  it('caps code requests harder than verifications', () => {
    const rules = options.rateLimit?.customRules;

    expect(rules?.['/phone-number/send-otp']).toEqual({ window: 60, max: 3 });
    expect(rules?.['/phone-number/verify']).toEqual({ window: 60, max: 10 });
  });
});

describe('sessions', () => {
  it('last thirty days — every re-login costs an SMS', () => {
    expect(options.session?.expiresIn).toBe(60 * 60 * 24 * 30);
  });
});

// The `rateLimit` model registration cannot be read back off the adapter — it
// is an opaque function — and a missing model does not throw, it just writes
// nowhere. `auth.integration.test.ts` proves it by counting rows in
// `rate_limit` after driving the real endpoint.
