import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_PATHS } from '@/lib/constant/paths';
import { app } from './index';
import { RATE_LIMITS } from './middleware/rate-limit';

// The app reaches the catalog routes, which reach the DAOs: importing it now
// imports `@/db`, which throws when APP_CONFIG_DATABASE_URL is unset. Nothing
// here calls a route that queries, so a stub is enough to keep this suite
// database-free — the catalog routes are exercised for real in
// ./routes/catalog.integration.test.ts.
vi.mock('@/db', () => ({ db: {} }));

// Smoke test for the Next ↔ Hono bridge: the app must mount under /api and
// answer through the standard envelope.
describe('hono app', () => {
  it('answers /api/health with a success envelope', async () => {
    const response = await app.request(API_PATHS.HEALTH);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'success',
      data: { status: 'ok' },
    });
  });

  it('serves the OpenAPI document outside production', async () => {
    const response = await app.request(API_PATHS.DOC);

    expect(response.status).toBe(200);
    const doc = (await response.json()) as { paths: Record<string, unknown> };
    // Paths carry the /api base path — proof the app is mounted, not just built.
    expect(Object.keys(doc.paths)).toContain(API_PATHS.HEALTH);
  });

  it('documents every catalog route in the OpenAPI document', async () => {
    // Scalar renders from this document: a route missing here is a route the
    // storefront stories have to reverse-engineer from the handler.
    const response = await app.request(API_PATHS.DOC);

    const doc = (await response.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        API_PATHS.CATEGORIES,
        API_PATHS.PRODUCTS,
        // Spelled out, not built from a constant: this asserts the path the
        // route registers, and a shared template both sides derived from would
        // agree with itself however the route was renamed.
        '/api/products/{slug}',
      ]),
    );
  });

  it('describes the product list query parameters in the document', async () => {
    const response = await app.request(API_PATHS.DOC);

    const doc = (await response.json()) as {
      paths: Record<string, { get: { parameters?: { name: string }[] } }>;
    };
    const names = (doc.paths[API_PATHS.PRODUCTS].get.parameters ?? []).map(
      (parameter) => parameter.name,
    );
    expect(names.sort()).toEqual([
      'category',
      'limit',
      'maxPrice',
      'minPrice',
      'page',
      'pet',
      'q',
      'sort',
    ]);
  });

  // Nothing in the six gates ever fetched this document until these. A
  // hand-written response schema was once registered under `ProductImage`, a
  // name the shared component already held; zod-to-openapi keeps the FIRST
  // schema it saw for a duplicate name and drops the second without a word, so
  // the reference described a gallery write without the `url` it returns while
  // every gate stayed green.
  //
  // A duplicate name leaves no trace in the output — the `$ref` still resolves
  // — so the guard is the source scan below. What these two check is the
  // document itself: that every `$ref` in it resolves, and that the two
  // deliberately-different image shapes are still two.
  it('leaves no $ref in the document pointing at a component that is not there', async () => {
    const response = await app.request(API_PATHS.DOC);
    const doc = (await response.json()) as Record<string, unknown>;

    const defined = new Set(
      Object.keys(
        ((doc.components as { schemas?: Record<string, unknown> })?.schemas ??
          {}) as Record<string, unknown>,
      ),
    );

    const refs: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string') refs.push(value);
        else walk(value);
      }
    };
    // The whole document, not just `paths`: a registered schema emits its
    // `$ref` nested inside `components.schemas`, so every image ref in this
    // API lives there and a walk of `paths` alone never visits one.
    walk(doc);

    expect(refs.length).toBeGreaterThan(0);
    const dangling = [
      ...new Set(
        refs.filter(
          (ref) => !defined.has(ref.replace('#/components/schemas/', '')),
        ),
      ),
    ];
    expect(dangling).toEqual([]);
  });

  it('documents the stored gallery image with the url the route returns', async () => {
    const response = await app.request(API_PATHS.DOC);
    const doc = (await response.json()) as {
      components: {
        schemas: Record<string, { properties?: Record<string, unknown> }>;
      };
    };

    const stored = doc.components.schemas.StoredProductImage;
    const shared = doc.components.schemas.ProductImage;

    // The two are deliberately different shapes under deliberately different
    // names. Collapse them back into one and this is the assertion that says so.
    expect(stored?.properties).toHaveProperty('url');
    expect(shared?.properties).not.toHaveProperty('url');
  });

  // The general net for the same bug class. A duplicate name leaves nothing to
  // find in the output — the `$ref` resolves, the document is valid, it simply
  // describes the wrong shape — so the only place to catch one is where names
  // are minted — and this is the only guard, deliberately. An import-time
  // throw was tried and removed: it duplicated this check while adding a way
  // for a dev-server module reload to take every `/api` route down with a
  // message naming the wrong cause. A test that fails the build is the right
  // blast radius for a naming mistake.
  it('mints every OpenAPI component name exactly once', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');

    const files: string[] = [];
    const walkDir = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walkDir(full);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
          files.push(full);
      }
    };
    await walkDir(join(process.cwd(), 'src/lib/hono'));

    const seen = new Map<string, string[]>();
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      // `.openapi('X')` is a chained call and matches directly.
      // `apiSuccessSchema(schema, 'X')` needs its argument list walked,
      // because the first argument can nest parens several levels deep — an
      // earlier version of this scan regexed for it, silently matched nothing,
      // and let the very collision it guards against pass.
      const helperNames = (src: string): string[] => {
        const found: string[] = [];
        const call = /apiSuccessSchema\(/g;
        let match = call.exec(src);
        while (match) {
          let depth = 1;
          let index = match.index + match[0].length;
          while (index < src.length && depth > 0) {
            if (src[index] === '(') depth += 1;
            if (src[index] === ')') depth -= 1;
            index += 1;
          }
          const args = src.slice(match.index + match[0].length, index - 1);
          const last = [...args.matchAll(/'([A-Za-z0-9_]+)'/g)].at(-1);
          if (last) found.push(last[1]);
          match = call.exec(src);
        }
        return found;
      };

      const names = [
        ...[...source.matchAll(/\.openapi\('([A-Za-z0-9_]+)'\)/g)].map(
          (m) => m[1],
        ),
        ...helperNames(source),
      ];

      for (const name of names) {
        seen.set(name, [...(seen.get(name) ?? []), file]);
      }
    }

    expect(seen.size).toBeGreaterThan(20);
    const duplicates = [...seen.entries()].filter(([, at]) => at.length > 1);
    expect(duplicates).toEqual([]);
  });

  it('serves the Scalar reference page outside production', async () => {
    const response = await app.request(API_PATHS.REFERENCE);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
  });

  it('404s an unknown route without leaving the /api base path', async () => {
    const response = await app.request('/api/nope');

    expect(response.status).toBe(404);
  });
});

describe('hono app in production', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // The docs describe every route the API has; they must not be a public map of
  // the admin panel. The gate reads NODE_ENV when the module is first evaluated,
  // so the production app has to be built from a fresh import.
  const loadProductionApp = async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    return (await import('./index')).app;
  };

  it('does not serve the OpenAPI document', async () => {
    const productionApp = await loadProductionApp();

    const response = await productionApp.request(API_PATHS.DOC);

    expect(response.status).toBe(404);
  });

  it('does not serve the Scalar reference page', async () => {
    const productionApp = await loadProductionApp();

    const response = await productionApp.request(API_PATHS.REFERENCE);

    expect(response.status).toBe(404);
  });

  it('still answers /api/health', async () => {
    // Guards against "fixing" the docs gate by disabling the whole app.
    const productionApp = await loadProductionApp();

    const response = await productionApp.request(API_PATHS.HEALTH);

    expect(response.status).toBe(200);
  });
});

// The mount POSITION of the rate limiter, pinned on the real exported `app`.
//
// Hono runs an `app.use('*')` only for routes registered AFTER it, so moving
// the mount below the `app.openapi(...)` calls — or adding a public route above
// it — silently stops limiting the public catalogue and the Zarinpal callback,
// the two routes the limiter exists for, while every other test stays green.
// That is the exact regression this describes; the unit tests in
// ./middleware/rate-limit.test.ts mount their own app and cannot see it.
describe('the rate limiter is mounted ahead of the routes', () => {
  const flood = async (path: string, ip: string, times: number) => {
    let lastStatus = 0;
    for (let i = 0; i < times; i++) {
      const response = await app.request(path, {
        headers: { 'cf-connecting-ip': ip },
      });
      lastStatus = response.status;
      if (lastStatus === 429 || lastStatus === 302) break;
    }
    return lastStatus;
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('covers the public catalogue, which is registered first', async () => {
    vi.stubEnv('APP_CONFIG_TRUST_CF_HEADER', 'true');

    expect(
      await flood(API_PATHS.PRODUCTS, '198.51.100.71', RATE_LIMITS.catalog + 5),
    ).toBe(429);
  });

  it('covers the unauthenticated payment callback', async () => {
    vi.stubEnv('APP_CONFIG_TRUST_CF_HEADER', 'true');

    // Over budget this route redirects rather than returning the envelope, so
    // a 302 here is the limiter answering, not the handler.
    expect(
      await flood(
        `${API_PATHS.PAYMENT_CALLBACK}?Authority=x&Status=NOK`,
        '198.51.100.72',
        RATE_LIMITS.paymentCallback + 5,
      ),
    ).toBe(302);
  });

  it('leaves the readiness probe uncounted', async () => {
    vi.stubEnv('APP_CONFIG_TRUST_CF_HEADER', 'true');

    expect(
      await flood(API_PATHS.READY, '198.51.100.73', RATE_LIMITS.default * 2),
    ).not.toBe(429);
  });
});

describe('the OpenAPI document declares the limiter', () => {
  it('attaches a 429 to every operation, including routes added later', async () => {
    // Declared once where the document is generated rather than in 35 route
    // files: the limiter is app-wide middleware, so a route file cannot know
    // it is limited, and per-route copies would drift the first time someone
    // adds a route without one.
    const document = await (await app.request(API_PATHS.DOC)).json();

    const operations = Object.values(
      document.paths as Record<string, Record<string, { responses?: object }>>,
    ).flatMap((path) => Object.values(path));

    expect(operations.length).toBeGreaterThan(0);
    for (const operation of operations) {
      expect(operation.responses).toHaveProperty('429');
    }
  });
});
