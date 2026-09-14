import { describe, expect, it, vi } from 'vitest';
import { ROLES } from '@/db/schema/auth';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: mocks.captureException,
  captureMessage: vi.fn(),
}));

// The module edge: the middleware's job is the decision, not Better Auth's
// session lookup, which has its own coverage in auth.integration.test.ts.
vi.mock('@/lib/auth', () => ({
  isAuthenticatedUser: mocks.getSession,
}));

const { createRouter } = await import('@/lib/hono/create-router');
const { requireAdmin, requireAuth } = await import('./auth');
type AuthedEnv = import('./auth').AuthedEnv;

const sessionFor = (role: string) => ({
  user: { id: 'u1', email: 'someone@example.com', role },
  session: { id: 's1' },
});

/** A throwaway router, because no admin API route exists yet to mount on. */
const routerWith = (guard: typeof requireAdmin) => {
  const app = createRouter();
  app.use('/guarded', guard);
  app.get('/guarded', (c) => c.json({ status: 'success', data: 'secret' }));
  return app;
};

const call = (guard: typeof requireAdmin) =>
  routerWith(guard).request('/guarded');

describe('requireAdmin', () => {
  it('answers 401 when there is no session at all', async () => {
    mocks.getSession.mockResolvedValue(null);

    expect((await call(requireAdmin)).status).toBe(401);
  });

  it('answers 403 to a signed-in customer', async () => {
    // The distinction that matters: a session is authentication, never
    // authorization. Customers get sessions from the same phone OTP flow.
    mocks.getSession.mockResolvedValue(sessionFor(ROLES.CUSTOMER));

    expect((await call(requireAdmin)).status).toBe(403);
  });

  it('answers 403 to a role it does not recognize', async () => {
    // Deny by default. A typo'd or future role must not read as permission.
    mocks.getSession.mockResolvedValue(sessionFor('superuser'));

    expect((await call(requireAdmin)).status).toBe(403);
  });

  it('answers 403 when the role is missing entirely', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'u1' }, session: {} });

    expect((await call(requireAdmin)).status).toBe(403);
  });

  it('lets an admin through to the handler', async () => {
    mocks.getSession.mockResolvedValue(sessionFor(ROLES.ADMIN));

    const response = await call(requireAdmin);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: 'secret' });
  });

  it('never runs the handler when it refuses', async () => {
    const handler = vi.fn();
    mocks.getSession.mockResolvedValue(sessionFor(ROLES.CUSTOMER));
    const app = createRouter();
    app.use('/guarded', requireAdmin);
    app.get('/guarded', handler);

    await app.request('/guarded');

    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses in Persian, in the standard error envelope', async () => {
    mocks.getSession.mockResolvedValue(sessionFor(ROLES.CUSTOMER));

    const body = await (await call(requireAdmin)).json();

    expect(body).toMatchObject({
      status: 'error',
      message: expect.stringMatching(/[؀-ۿ]/),
    });
  });

  it('says nothing about who is signed in', async () => {
    // A 403 that echoed the role or the email would confirm account details to
    // anyone probing the admin API with a stolen customer session.
    mocks.getSession.mockResolvedValue(sessionFor(ROLES.CUSTOMER));

    const body = JSON.stringify(await (await call(requireAdmin)).json());

    expect(body).not.toContain('someone@example.com');
    expect(body).not.toContain('u1');
  });

  it('answers 401 when the session lookup itself fails', async () => {
    // Fail closed: an auth check that errored has not authorized anything.
    mocks.getSession.mockRejectedValue(new Error('connection refused'));

    expect((await call(requireAdmin)).status).toBe(401);
  });

  it('reports the failed session lookup rather than passing it off as a 401', async () => {
    // The client sees the same 401 either way, so a database blip is otherwise
    // indistinguishable from "not signed in" — invisible until someone reads
    // the container log for an unrelated reason.
    const failure = new Error('connection refused');
    mocks.captureException.mockClear();
    mocks.getSession.mockRejectedValue(failure);

    await call(requireAdmin);

    expect(mocks.captureException).toHaveBeenCalledWith(failure);
  });
});

describe('requireAuth', () => {
  it('answers 401 without a session', async () => {
    mocks.getSession.mockResolvedValue(null);

    expect((await call(requireAuth)).status).toBe(401);
  });

  it('lets a customer through — this gate is not about role', async () => {
    mocks.getSession.mockResolvedValue(sessionFor(ROLES.CUSTOMER));

    expect((await call(requireAuth)).status).toBe(200);
  });

  it('lets an admin through too', async () => {
    mocks.getSession.mockResolvedValue(sessionFor(ROLES.ADMIN));

    expect((await call(requireAuth)).status).toBe(200);
  });

  it('publishes the session for the handler to scope its reads by', async () => {
    // Every customer-facing read is owner-scoped; the handler needs the id to
    // scope by, and taking it from the session is what makes an IDOR
    // impossible to write by accident.
    mocks.getSession.mockResolvedValue(sessionFor(ROLES.CUSTOMER));
    const app = createRouter<AuthedEnv>();
    app.use('/me', requireAuth);
    app.get('/me', (c) => c.json({ id: c.get('user').id }));

    expect(await (await app.request('/me')).json()).toEqual({ id: 'u1' });
  });
});
