import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SentryIntegration } from './sentry';

// `sentryOptions` reads NEXT_PUBLIC_* through env.ts, which captures those into
// STATIC_INLINED_VARS at module load so the bundler can inline them for the
// client. `vi.stubEnv` alone therefore does not reach it — the value has to be
// set BEFORE the module graph is (re)loaded. Same shape as image-url.test.ts.
const freshSentry = async (env: Record<string, string>) => {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.resetModules();
  return import('./sentry');
};

const integration = (name: string) => ({ name }) as SentryIntegration;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('withoutConsoleBreadcrumbs', () => {
  it('drops the Console integration', async () => {
    const { withoutConsoleBreadcrumbs } = await freshSentry({});

    expect(withoutConsoleBreadcrumbs([integration('Console')])).toEqual([]);
  });

  it('keeps every other integration, in order', async () => {
    const { withoutConsoleBreadcrumbs } = await freshSentry({});
    const kept = withoutConsoleBreadcrumbs([
      integration('Http'),
      integration('Console'),
      integration('OnUncaughtException'),
      integration('Breadcrumbs'),
    ]);

    expect(kept.map((i) => i.name)).toEqual([
      'Http',
      'OnUncaughtException',
      'Breadcrumbs',
    ]);
  });

  it('handles an empty list', async () => {
    const { withoutConsoleBreadcrumbs } = await freshSentry({});

    expect(withoutConsoleBreadcrumbs([])).toEqual([]);
  });

  it('drops every Console entry, not just the first', async () => {
    // Defensive: `filter` already does this, but an implementation that switched
    // to findIndex/splice would pass the single-entry case and leak here.
    const { withoutConsoleBreadcrumbs } = await freshSentry({});
    const kept = withoutConsoleBreadcrumbs([
      integration('Console'),
      integration('Console'),
      integration('Http'),
    ]);

    expect(kept.map((i) => i.name)).toEqual(['Http']);
  });
});

describe('sentryOptions', () => {
  describe('dsn', () => {
    it('is undefined when the variable is unset, so the SDK stays off', async () => {
      const { sentryOptions } = await freshSentry({
        NEXT_PUBLIC_SENTRY_DSN: '',
      });

      expect(sentryOptions().dsn).toBeUndefined();
    });

    it('is undefined for a whitespace-only value', async () => {
      // `NEXT_PUBLIC_SENTRY_DSN= ` left in a .env is an unset one. An empty-ish
      // string handed to Sentry.init is an invalid-DSN warning on every boot.
      const { sentryOptions } = await freshSentry({
        NEXT_PUBLIC_SENTRY_DSN: '   ',
      });

      expect(sentryOptions().dsn).toBeUndefined();
    });

    it('passes a configured DSN through, trimmed', async () => {
      const { sentryOptions } = await freshSentry({
        NEXT_PUBLIC_SENTRY_DSN: '  https://abc@o1.ingest.us.sentry.io/2  ',
      });

      expect(sentryOptions().dsn).toBe('https://abc@o1.ingest.us.sentry.io/2');
    });
  });

  describe('environment', () => {
    it('is undefined when unset', async () => {
      const { sentryOptions } = await freshSentry({
        NEXT_PUBLIC_SENTRY_ENVIRONMENT: '',
      });

      expect(sentryOptions().environment).toBeUndefined();
    });

    it('keeps staging distinguishable from production', async () => {
      const { sentryOptions } = await freshSentry({
        NEXT_PUBLIC_SENTRY_ENVIRONMENT: 'staging',
      });

      expect(sentryOptions().environment).toBe('staging');
    });
  });

  describe('tracing', () => {
    it('stays off — the SDK enables tracing merely by seeing a sample rate', async () => {
      // `tracesSampleRate: 0` would still be "defined" to some SDK code paths,
      // and a stray 0.1 is how a shared event quota quietly goes to transactions
      // instead of the errors this exists to catch. Absent, not zero.
      const { sentryOptions } = await freshSentry({ NODE_ENV: 'production' });

      expect(sentryOptions()).not.toHaveProperty('tracesSampleRate');
      expect(sentryOptions()).not.toHaveProperty('tracesSampler');
    });
  });

  describe('dataCollection — the privacy contract', () => {
    // `dataCollection` is opt-OUT: passing the object resolves every omitted
    // category to its PERMISSIVE default. For a phone-OTP shop the three that
    // matter are cookies (the session), httpBodies (the OTP in the send-otp
    // POST) and stackFrameVariables (the plaintext code in a local). This test
    // fails if any category is dropped from the object, not just if one is
    // flipped — which is the mistake that is easy to make.
    it('pins every category to its restrictive value', async () => {
      const { sentryOptions } = await freshSentry({});

      expect(sentryOptions().dataCollection).toEqual({
        userInfo: false,
        cookies: false,
        httpHeaders: { request: false, response: false },
        httpBodies: [],
        urlQueryParams: false,
        databaseQueryData: false,
        stackFrameVariables: false,
      });
    });

    it('collects no HTTP body at all', async () => {
      // The sign-in request body is `{ phoneNumber, code }`.
      const { sentryOptions } = await freshSentry({});

      expect(sentryOptions().dataCollection.httpBodies).toHaveLength(0);
    });
  });

  it('installs the console-breadcrumb filter', async () => {
    const { sentryOptions, withoutConsoleBreadcrumbs } = await freshSentry({});

    expect(sentryOptions().integrations).toBe(withoutConsoleBreadcrumbs);
  });
});

describe('sanitizeDatabaseError', () => {
  it('preserves safe exception types and frames while removing copied payloads', async () => {
    const { sanitizeDatabaseError } = await freshSentry({});
    const frames = [{ filename: 'AddressDao.ts', lineno: 42 }];
    const result = sanitizeDatabaseError(
      {
        type: undefined,
        message: 'Private value',
        extra: { params: ['Private value'] },
        exception: {
          values: [
            { type: 'Error', value: 'Private value', stacktrace: { frames } },
          ],
        },
      },
      { originalException: { query: 'insert ...', params: ['Private value'] } },
    );
    expect(result.message).toBe('Database operation failed');
    expect(result.extra).toBeUndefined();
    expect(result.exception?.values?.[0]).toEqual({
      type: 'Error',
      value: 'Database operation failed',
      stacktrace: { frames },
    });
  });

  it('handles empty events and database errors without causes', async () => {
    const { sanitizeDatabaseError } = await freshSentry({});
    expect(
      sanitizeDatabaseError(
        { type: undefined },
        {
          originalException: { query: '', params: [] },
        },
      ).exception,
    ).toBeUndefined();
  });

  it('leaves non-database errors, invalid shapes and cycles unchanged', async () => {
    const { sanitizeDatabaseError } = await freshSentry({});
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    const event = { type: undefined, message: 'Useful diagnosis' };
    for (const originalException of [
      undefined,
      null,
      'failure',
      {},
      { query: 'query', params: 'not an array' },
      cyclic,
    ]) {
      expect(sanitizeDatabaseError(event, { originalException })).toBe(event);
    }
  });
});
