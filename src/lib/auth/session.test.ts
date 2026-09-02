import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PATHS, PROTECTED_PATHS } from '@/lib/constant/paths';

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

const { requireAdmin, requireSession } = await import('./session');

const sessionFor = (role: string) => ({
  user: { id: 'u1', email: 'someone@example.com', role },
});

describe('requireAdmin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends a signed-out visitor to the login page', async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(requireAdmin()).rejects.toThrow(
      `REDIRECT:${PATHS.LOGIN}?next=`,
    );
  });

  it('remembers the admin panel as where to return to', async () => {
    // Otherwise signing in drops the admin on the storefront and they have to
    // navigate back — every time, since the session is what expired.
    mocks.getSession.mockResolvedValue(null);

    await expect(requireAdmin()).rejects.toThrow(
      `REDIRECT:${PATHS.LOGIN}?next=${encodeURIComponent(PROTECTED_PATHS.INDEX)}`,
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

describe('requireSession', () => {
  // The gate on `/account`. A session is all it checks — the page is still
  // responsible for scoping every read to `session.user.id` — but if this
  // check goes missing the page renders for a signed-out visitor and then
  // dereferences `session.user`.
  beforeEach(() => vi.clearAllMocks());

  it('sends a signed-out visitor to the login page', async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(requireSession(PATHS.ACCOUNT)).rejects.toThrow(
      `REDIRECT:${PATHS.LOGIN}?next=${encodeURIComponent(PATHS.ACCOUNT)}`,
    );
  });

  it('remembers where they were headed, so the code lands them back on it', async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(requireSession(PATHS.CHECKOUT)).rejects.toThrow(
      `REDIRECT:${PATHS.LOGIN}?next=${encodeURIComponent(PATHS.CHECKOUT)}`,
    );
  });

  it('does not carry a ?next= when the destination is home anyway', async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(requireSession(PATHS.HOME)).rejects.toThrow(
      `REDIRECT:${PATHS.LOGIN}`,
    );
  });

  it('refuses an off-site return target rather than bouncing to it', async () => {
    // `requireSession` takes a string; an open redirect here would be a
    // phishing link that launders itself through a real login page.
    mocks.getSession.mockResolvedValue(null);

    await expect(requireSession('//evil.example')).rejects.toThrow(
      `REDIRECT:${PATHS.LOGIN}`,
    );
  });

  it('lets a signed-in customer through and returns the session', async () => {
    const session = sessionFor('customer');
    mocks.getSession.mockResolvedValue(session);

    await expect(requireSession(PATHS.ACCOUNT)).resolves.toBe(session);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('lets an admin through too — it gates on a session, not a role', async () => {
    const session = sessionFor('admin');
    mocks.getSession.mockResolvedValue(session);

    await expect(requireSession(PATHS.ACCOUNT)).resolves.toBe(session);
  });
});
