import { describe, expect, it } from 'vitest';
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
