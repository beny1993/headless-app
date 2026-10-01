// @vitest-environment node
import { createServer, get, type Server } from 'node:http';
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
    // A local transport: no events leave this process. Only an event's
    // envelope is kept: once the SDK detects a release (`SENTRY_RELEASE`, or
    // the commit variables every CI sets), a flush sends request sessions too.
    transport: () => ({
      send: async (envelope: unknown) => {
        const [, [[item]]] = envelope as [unknown, [[{ type: string }]]];
        if (item.type === 'event') captured = JSON.stringify(envelope);
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

    // The number, not its first digits: «0912» turns up by chance in a random
    // event id and, for 17 minutes on 2026-10-02, in every epoch timestamp.
    expect(event).not.toContain('9121234567');
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

// The s3 driver's own requests — the put, the anonymous probe, the delete —
// are recorded by the Node SDK as `http` breadcrumbs, each URL ending in the
// receipt's object key, and every event captured later in that request takes
// them along: the exposure alarm, the probe's warning, a failed clean-up.
describe('receipt key privacy', () => {
  it('sends no receipt key in a breadcrumb URL', async () => {
    const id = crypto.randomUUID();
    Sentry.getIsolationScope().clearBreadcrumbs();
    Sentry.addBreadcrumb({
      category: 'http',
      type: 'http',
      data: {
        url: `https://x/bucket/receipts/${id}.jpg`,
        'http.method': 'PUT',
        'http.query': '?x-id=PutObject',
        status_code: 200,
      },
    });
    Sentry.addBreadcrumb({
      category: 'navigation',
      data: {
        from: `/bucket/receipts/${id}.png?x-id=GetObject`,
        to: `/bucket/receipts/${id}.webp#top`,
      },
    });
    captured = undefined;
    Sentry.captureMessage('[storage] a receipt was readable anonymously');
    await Sentry.flush(2000);

    expect(captured).toBeDefined();
    expect(captured).not.toContain(id);
    expect(captured).toContain('https://x/bucket/receipts/[redacted]');
    expect(captured).toContain('/bucket/receipts/[redacted]?x-id=GetObject');
  });

  // The other shapes a key reaches a breadcrumb in: a redirect hop that
  // percent-encoded the slash, a query string (which the SDK keeps apart from
  // the URL, as `http.query`), and a bucket whose own name is `receipts`.
  it.each([
    [
      'a redirect hop that encoded the slash',
      (id: string) => ({ url: `https://cdn/x/receipts%2F${id}.jpg` }),
    ],
    [
      'a query string',
      (id: string) => ({
        url: 'https://cdn/x',
        'http.query': `?file=receipts/${id}.jpg`,
      }),
    ],
    [
      'a bucket named receipts',
      (id: string) => ({ url: `https://x/receipts/receipts/${id}.jpg` }),
    ],
  ])('sends no receipt key from %s', async (_, data) => {
    const id = crypto.randomUUID();
    Sentry.getIsolationScope().clearBreadcrumbs();
    Sentry.addBreadcrumb({ category: 'http', type: 'http', data: data(id) });
    captured = undefined;
    Sentry.captureMessage('[storage] a receipt was readable anonymously');
    await Sentry.flush(2000);

    expect(captured).toBeDefined();
    expect(captured).not.toContain(id);
  });

  it('sends no receipt key that a storage error quotes', async () => {
    // AWS's AccessDenied names the object it refused. A failed GetObject is
    // rethrown by `readReceipt`, and the API's error boundary captures it.
    const id = crypto.randomUUID();
    Sentry.getIsolationScope().clearBreadcrumbs();
    const error = new Error(
      `User: arn:aws:iam::1:user/app is not authorized to perform: s3:GetObject on resource: "arn:aws:s3:::bucket/receipts/${id}.jpg"`,
    );
    error.name = 'AccessDenied';
    const event = await capture(error);

    expect(event).not.toContain(id);
    expect(event).toContain('bucket/receipts/[redacted]');
  });

  describe('in the breadcrumbs the SDK records itself', () => {
    let server: Server;
    let origin = '';

    beforeAll(async () => {
      server = createServer((request, response) => {
        // A socket per request: each breadcrumb is then recorded in the
        // context of the request that made it, as in a test it must be.
        response.setHeader('connection', 'close');
        request.resume();
        request.on('end', () => response.end('x'));
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    const httpGet = (url: string) =>
      new Promise<void>((resolve, reject) => {
        get(url, (response) => {
          response.resume();
          response.on('end', resolve);
        }).on('error', reject);
      });

    it('sends no receipt key from a real fetch or http.request', async () => {
      const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
      Sentry.getIsolationScope().clearBreadcrumbs();
      await (await fetch(`${origin}/bucket/receipts/${ids[0]}.jpg`)).text();
      await (await fetch(`${origin}/receipts/receipts/${ids[1]}.jpg`)).text();
      await httpGet(`${origin}/bucket/x?file=receipts/${ids[2]}.jpg`);
      await httpGet(`${origin}/bucket/x/receipts%2F${ids[3]}.jpg`);
      captured = undefined;
      Sentry.captureMessage('[storage] a receipt was readable anonymously');
      await Sentry.flush(2000);

      expect(captured).toBeDefined();
      for (const id of ids) expect(captured).not.toContain(id);
      // The SDK did record all four, each scrubbed where it filed the key:
      // the URL, or the query it keeps apart from it.
      for (const scrubbed of [
        `${origin}/bucket/receipts/[redacted]`,
        `${origin}/receipts/[redacted]`,
        '?file=receipts/[redacted]',
        `${origin}/bucket/x/receipts%2F[redacted]`,
      ]) {
        expect(captured).toContain(scrubbed);
      }
    });
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
