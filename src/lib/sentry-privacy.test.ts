// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sentryOptions } from './sentry';

// Exercise the installed Node SDK's serialization, including linked causes.
const Sentry = createRequire(import.meta.url)(
  '@sentry/nextjs',
) as typeof import('@sentry/nextjs');

let captured: string | undefined;
beforeAll(() => {
  const options = sentryOptions();
  Sentry.init({
    ...options,
    dsn: 'https://public@example.invalid/1',
    integrations: (defaults) =>
      options
        .integrations(defaults)
        .filter((integration) => integration.name !== 'ContextLines'),
    // A local transport: no events leave this process.
    transport: () => ({
      send: async (envelope: unknown) => {
        captured = JSON.stringify(envelope);
        return {};
      },
      flush: async () => true,
    }),
  });
});
afterAll(async () => {
  await Sentry.close(2000);
});
async function capture(error: Error, extra?: Record<string, unknown>) {
  captured = undefined;
  Sentry.captureException(error, { extra });
  await Sentry.flush(2000);
  expect(captured).toBeDefined();
  return captured!;
}

describe('database exception privacy', () => {
  it('removes query parameters and PostgreSQL cause values from the serialized event', async () => {
    const error = new DrizzleQueryError(
      'insert into addresses values ($1, $2)',
      ['PRIVATE_PHONE', 'PRIVATE_POSTAL_ADDRESS'],
      new Error('Key (phone)=(PRIVATE_PHONE) already exists.'),
    );
    const event = await capture(error);
    expect(event).not.toContain('PRIVATE_PHONE');
    expect(event).not.toContain('PRIVATE_POSTAL_ADDRESS');
    expect(event).toContain('Database operation failed');
    expect(event).toContain('stacktrace');
  });

  it('recognizes a database error nested under an application error', async () => {
    const event = await capture(
      new Error('Could not save PRIVATE_ADDRESS', {
        cause: new DrizzleQueryError('insert into addresses values ($1)', [
          'PRIVATE_ADDRESS',
        ]),
      }),
    );
    expect(event).not.toContain('PRIVATE_ADDRESS');
    expect(event).toContain('Database operation failed');
  });

  it('keeps safe payment correlation ids while dropping arbitrary extras', async () => {
    const event = await capture(
      new DrizzleQueryError('update payments set status = $1', [
        'PRIVATE_VALUE',
      ]),
      {
        paymentId: 'safe-payment-id',
        orderId: 'safe-order-id',
        params: ['PRIVATE_VALUE'],
      },
    );
    expect(event).toContain('safe-payment-id');
    expect(event).toContain('safe-order-id');
    expect(event).not.toContain('PRIVATE_VALUE');
  });

  it('preserves ordinary error diagnostics', async () => {
    expect(await capture(new Error('Ordinary failure'))).toContain(
      'Ordinary failure',
    );
  });
});

// The users search is a GET form: `?q=` on an admin URL can be a customer's
// phone or name, and the SDK sends the page URL whole — `urlQueryParams: false`
// only drops the separate `query_string`.
describe('admin query string privacy', () => {
  const SEARCH = 'https://shop.example/admin-panel/users?q=09121234567';

  async function captureWith(url: string, breadcrumbUrl: string) {
    Sentry.getIsolationScope().clearBreadcrumbs();
    Sentry.addBreadcrumb({
      category: 'navigation',
      data: { from: breadcrumbUrl, to: '/admin-panel/users/abc' },
    });
    Sentry.addBreadcrumb({
      category: 'fetch',
      data: { method: 'GET', url: `${breadcrumbUrl}&_rsc=1` },
    });
    captured = undefined;
    Sentry.captureEvent({
      message: 'Render failed',
      request: { url, headers: { Referer: url } },
    });
    await Sentry.flush(2000);
    expect(captured).toBeDefined();
    return captured!;
  }

  it('sends no admin query in the request URL, its Referer or a breadcrumb', async () => {
    const event = await captureWith(SEARCH, '/admin-panel/users?q=09121234567');

    expect(event).not.toContain('0912');
    expect(event).toContain('https://shop.example/admin-panel/users');
    expect(event).toContain('/admin-panel/users/abc');
  });

  it('leaves a storefront URL and its query as they are', async () => {
    const event = await captureWith(
      'https://shop.example/shop?q=royal',
      '/shop?q=royal',
    );

    expect(event).toContain('https://shop.example/shop?q=royal');
    expect(event).toContain('/shop?q=royal&_rsc=1');
  });

  // A server error while an admin page renders reaches the SDK through Next's
  // `onRequestError` (`src/instrumentation.ts`), whose `path` is `req.url`,
  // query included. The SDK files it under `contexts.nextjs.request_path`.
  async function captureRequestError(path: string, routePath: string) {
    Sentry.getIsolationScope().clearBreadcrumbs();
    captured = undefined;
    Sentry.captureRequestError(
      new Error('Render failed'),
      { path, method: 'GET', headers: {} },
      { routerKind: 'App Router', routePath, routeType: 'render' },
    );
    await Sentry.flush(2000);
    expect(captured).toBeDefined();
    const [, [[, event]]] = JSON.parse(captured!) as [
      unknown,
      [[unknown, { contexts?: { nextjs?: { request_path?: unknown } } }]],
    ];
    return {
      raw: captured!,
      requestPath: event.contexts?.nextjs?.request_path,
    };
  }

  it('sends no admin phone search in the path of an error Next reports', async () => {
    const { raw, requestPath } = await captureRequestError(
      '/admin-panel/users?q=09121234567',
      '/admin-panel/users',
    );

    // The whole envelope, not one field: were the SDK to rename the key, the
    // number would travel under the new one and still fail this.
    expect(raw).not.toContain('9121234567');
    expect(requestPath).toBe('/admin-panel/users');
  });

  it('sends no admin name search in that path either', async () => {
    const name = encodeURIComponent('علی رضایی');
    const { raw, requestPath } = await captureRequestError(
      `/admin-panel/users?q=${name}`,
      '/admin-panel/users',
    );

    expect(raw).not.toContain(name);
    expect(requestPath).toBe('/admin-panel/users');
  });

  it('leaves a storefront path and its query in that field', async () => {
    const { requestPath } = await captureRequestError('/shop?q=royal', '/shop');

    expect(requestPath).toBe('/shop?q=royal');
  });
});

// `httpBodies: []` is not the whole of it: the Node `Http` integration records
// an incoming body read through `req.on('data')` without consulting that list.
describe('request body privacy', () => {
  let server: Server;
  let origin = '';

  beforeAll(async () => {
    server = createServer((request, response) => {
      void (async () => {
        // Read as a stream consumer (`pipe`, busboy) reads it, then fail
        // inside the request, as a handler that awaits its body would.
        await new Promise<void>((resolve) => {
          request.on('data', () => {});
          request.on('end', resolve);
        });
        Sentry.captureException(new Error('Sign-in failed'));
        response.end();
      })();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('sends no body the server read', async () => {
    captured = undefined;
    const url = `${origin}/api/auth/phone-number/verify`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phoneNumber: '+989121234567', code: '482913' }),
    });
    await response.text();
    await Sentry.flush(2000);

    expect(captured).toBeDefined();
    const [, [[, event]]] = JSON.parse(captured!) as [
      unknown,
      [[unknown, { request?: { url?: string; data?: unknown } }]],
    ];
    // The request's own scope was on the event: its body had a way in.
    expect(event.request?.url).toBe(url);
    expect(event.request?.data).toBeUndefined();
    expect(captured).not.toContain('9121234567');
    expect(captured).not.toContain('482913');
  });
});
