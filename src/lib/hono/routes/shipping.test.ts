// No database needed. Two things run here without one: the query/body/param
// validation (rejected by the router's `defaultHook` before a handler touches
// the DAO) and the admin guard on the update route (decided by a mocked session,
// before the handler runs). `@/db` is stubbed so importing the app — which now
// pulls in the shipping routes and their DAO — does not throw on the missing
// APP_CONFIG_DATABASE_URL.
//
// The DB-backed behaviour (real lookups, a real admin update) is covered against
// Postgres in ./shipping.integration.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { ROLES } from '@/db/schema/auth';
import { API_PATHS, apiShippingRatePath } from '@/lib/constant/paths';
import type { ApiError } from '@/lib/hono/envelope';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth', () => ({ isAuthenticatedUser: mocks.getSession }));

const { app } = await import('@/lib/hono');

const sessionFor = (role: string) => ({
  user: { id: 'u1', email: 'someone@example.com', role },
  session: { id: 's1' },
});

const putRate = (provinceId: number, body: unknown) =>
  app.request(apiShippingRatePath(provinceId), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('GET /api/shipping/rates — query validation (public)', () => {
  const rejects = async (query: string) => {
    const response = await app.request(`${API_PATHS.SHIPPING_RATES}?${query}`);
    return {
      status: response.status,
      body: (await response.json()) as ApiError,
    };
  };

  it.each([
    ['a non-numeric province', 'province=abc'],
    ['province zero (ids start at 1)', 'province=0'],
    ['a negative province', 'province=-1'],
    ['a fractional province', 'province=1.5'],
    ['a province past the safe-integer range', 'province=1e30'],
    // A null byte must never reach Postgres as text (it would throw a 500);
    // coercion rejects it as a bad number first.
    ['a province carrying a null byte', 'province=%00'],
  ])('rejects %s with 400, never 500', async (_label, query) => {
    const { status, body } = await rejects(query);

    expect(status).toBe(400);
    expect(body.status).toBe('error');
  });

  it('does not require a session — the fee preview is public', async () => {
    // No `province`, so it reaches the handler; the stubbed db then fails it with
    // a 500. Anything but 401 proves the listing is not behind the admin guard.
    mocks.getSession.mockResolvedValue(null);

    const status = (await app.request(API_PATHS.SHIPPING_RATES)).status;

    expect(status).not.toBe(401);
    expect(status).not.toBe(403);
  });
});

describe('PUT /api/shipping/rates/{provinceId} — admin guard', () => {
  it('answers 401 when there is no session', async () => {
    mocks.getSession.mockResolvedValue(null);

    expect((await putRate(7, { fee: 30_000 })).status).toBe(401);
  });

  it('answers 403 to a signed-in customer', async () => {
    // A session is authentication, never authorization — customers get one from
    // the same phone-OTP flow.
    mocks.getSession.mockResolvedValue(sessionFor(ROLES.CUSTOMER));

    expect((await putRate(7, { fee: 30_000 })).status).toBe(403);
  });

  it('answers 403 to a role it does not recognize', async () => {
    mocks.getSession.mockResolvedValue(sessionFor('superuser'));

    expect((await putRate(7, { fee: 30_000 })).status).toBe(403);
  });

  it('authorizes before it parses the body — a bad fee without a session is 401', async () => {
    // The guard must short-circuit before validation, or an unauthenticated
    // caller could probe the body schema.
    mocks.getSession.mockResolvedValue(null);

    expect((await putRate(7, { fee: -1 })).status).toBe(401);
  });

  it('lets an admin past the guard to the handler', async () => {
    // Past the guard the stubbed db fails the handler with a 500 — anything but
    // 401/403 proves the admin was authorized.
    mocks.getSession.mockResolvedValue(sessionFor(ROLES.ADMIN));

    const status = (await putRate(7, { fee: 30_000 })).status;

    expect(status).not.toBe(401);
    expect(status).not.toBe(403);
  });

  it.each([
    ['a negative fee', { fee: -1 }],
    ['a fractional fee', { fee: 1500.5 }],
    ['a fee sent as a string', { fee: '30000' }],
    ['a missing fee', {}],
  ])('rejects %s from an admin with 400', async (_label, body) => {
    mocks.getSession.mockResolvedValue(sessionFor(ROLES.ADMIN));

    expect((await putRate(7, body)).status).toBe(400);
  });
});
