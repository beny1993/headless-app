import { describe, expect, it, vi } from 'vitest';
import { HTTPException } from 'hono/http-exception';

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  production: false,
}));

// `isProductionServer` reads NODE_ENV as captured at module load, so the
// production branch is switched here rather than with `vi.stubEnv`.
vi.mock('@/lib/utils/env', async (original) => ({
  ...(await original<typeof import('@/lib/utils/env')>()),
  isProductionServer: () => mocks.production,
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: mocks.captureException,
  captureMessage: vi.fn(),
}));

const { apiErrorHandler, createRouter } = await import('./create-router');

/** A router whose single route throws whatever it is handed. */
const throwing = (error: Error) => {
  const app = createRouter();
  app.onError(apiErrorHandler);
  app.get('/boom', () => {
    throw error;
  });
  return app;
};

const callBoom = async (error: Error) => {
  const silent = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.captureException.mockClear();
  const response = await throwing(error).request('/boom', { method: 'GET' });
  silent.mockRestore();
  warn.mockRestore();
  return response;
};

describe('apiErrorHandler', () => {
  it('reports an unhandled error with the route that produced it', async () => {
    // This handler answers with the 500 envelope, so the throw never reaches
    // Next's `onRequestError` — without this capture every API 500 in the app
    // would be invisible to Sentry.
    const failure = new Error('the database went away');

    const response = await callBoom(failure);

    expect(response.status).toBe(500);
    expect(mocks.captureException).toHaveBeenCalledWith(failure, {
      extra: { method: 'GET', path: '/boom' },
    });
  });

  it('does not report a client error', async () => {
    // A 400 from the json validator is the client's fault and arrives in bulk
    // from scanners. Reporting them would bury the 500s that mean something.
    const response = await callBoom(
      new HTTPException(400, { message: 'Malformed JSON in request body' }),
    );

    expect(response.status).toBe(400);
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it('reports a 5xx HTTPException — a thrown 503 is still an incident', async () => {
    const failure = new HTTPException(503, { message: 'upstream is down' });

    await callBoom(failure);

    expect(mocks.captureException).toHaveBeenCalledWith(failure, {
      extra: { method: 'GET', path: '/boom' },
    });
  });

  it('keeps the error out of the response body in production', async () => {
    // The capture is what carries the detail now; the envelope must not.
    mocks.production = true;
    const response = await callBoom(new Error('connection string: secret'));
    const body = await response.text();
    mocks.production = false;

    expect(body).not.toContain('secret');
    expect(mocks.captureException).toHaveBeenCalled();
  });
});
