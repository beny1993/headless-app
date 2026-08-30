import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_PATHS, PATHS } from '@/lib/constant/paths';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  // Next's real `redirect` throws to unwind the render — mirror that, or the
  // code under test would keep running past a redirect it should never survive.
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('./index', () => ({ auth: { api: { getSession: mocks.getSession } } }));

const { requireAdmin } = await import('./session');

const sessionFor = (role: string) => ({
  user: { id: 'u1', email: 'someone@example.com', role },
});

describe('requireAdmin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends a signed-out visitor to sign-in', async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(requireAdmin()).rejects.toThrow(
      `REDIRECT:${AUTH_PATHS.SIGNIN}`,
    );
  });

  it('turns a signed-in customer away from the admin panel', async () => {
    // The whole point of the gate: a valid session is not authorization.
    mocks.getSession.mockResolvedValue(sessionFor('customer'));

    await expect(requireAdmin()).rejects.toThrow(`REDIRECT:${PATHS.HOME}`);
  });

  it('turns away an unrecognized role rather than defaulting to allow', async () => {
    mocks.getSession.mockResolvedValue(sessionFor('superuser'));

    await expect(requireAdmin()).rejects.toThrow(`REDIRECT:${PATHS.HOME}`);
  });

  it('lets an admin through and returns the session', async () => {
    const session = sessionFor('admin');
    mocks.getSession.mockResolvedValue(session);

    await expect(requireAdmin()).resolves.toBe(session);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
