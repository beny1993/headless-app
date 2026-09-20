import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_PATHS, API_PRODUCT_DETAIL_TEMPLATE } from '@/lib/constant/paths';
import { app } from './index';

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
        API_PRODUCT_DETAIL_TEMPLATE,
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

  // Nothing in the six gates ever fetched this document until these two. A
  // hand-written response schema was once registered under `ProductImage`, a
  // name the shared component already held; zod-to-openapi keeps the FIRST
  // schema it saw for a duplicate name and drops the second without a word, so
  // `/api/reference` described both gallery writes without their `url` while
  // every gate stayed green. A duplicate name is invisible in the output — the
  // two survivors of it are a dangling `$ref` and a component whose shape is
  // not the one its route returns, so those are what these check.
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
    walk(doc.paths);

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
