import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_PATHS } from '@/lib/constant/paths';
import { app } from './index';

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
