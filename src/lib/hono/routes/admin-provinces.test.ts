// `PUT /api/admin/provinces/fee` — one fee for every province — driven through
// the real Hono `app`, so the `/admin/*` guard and the body validation are the
// mounted ones, not a handler in isolation.
//
// No database, on purpose: the write behind this route rewrites EVERY rate row,
// the 31 seeded ones included, and a request cannot be rolled back the way the
// DAO's own integration test rolls its transaction back. So `@/db` is stubbed
// (as in ./shipping.test.ts) and `ShippingRateDao.setAllFees` — the module edge
// — is a recorder; what that one `UPDATE` really does is proven against Postgres
// in src/db/dao/ShippingRateDao.integration.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROLES } from '@/db/schema/auth';
import { API_PATHS } from '@/lib/constant/paths';
import type { ApiResponse } from '@/lib/hono/envelope';
import type { AdminProvinceResponse } from '@/lib/hono/routes/shipping';
import { SHIPPING_FEE_MESSAGE } from '@/lib/shipping/shipping-query';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth', () => ({ isAuthenticatedUser: mocks.getSession }));

const { app } = await import('@/lib/hono');
const { ShippingRateDao } = await import('@/db/dao/ShippingRateDao');

const ROWS: AdminProvinceResponse[] = [
  { provinceId: 1, name: 'تهران', fee: 30_000, isActive: true },
  { provinceId: 7, name: 'اصفهان', fee: 30_000, isActive: false },
];

const setAllFees = vi.spyOn(ShippingRateDao, 'setAllFees');

const sessionFor = (role: string) => ({
  user: { id: 'u1', email: 'someone@example.com', role },
  session: { id: 's1' },
});

const putFee = (body: unknown) =>
  app.request(API_PATHS.ADMIN_PROVINCES_FEE, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

afterEach(() => {
  mocks.getSession.mockReset();
  setAllFees.mockReset();
});

describe('PUT /api/admin/provinces/fee', () => {
  it('answers 401 without a session, and writes nothing', async () => {
    mocks.getSession.mockResolvedValue(null);

    expect((await putFee({ fee: 30_000 })).status).toBe(401);
    expect(setAllFees).not.toHaveBeenCalled();
  });

  it.each([
    ['a signed-in customer', ROLES.CUSTOMER],
    ['a role it does not recognize', 'superuser'],
  ])('answers 403 to %s, and writes nothing', async (_label, role) => {
    // A session is authentication, never authorization — customers get one from
    // the same phone-OTP flow.
    mocks.getSession.mockResolvedValue(sessionFor(role));

    expect((await putFee({ fee: 30_000 })).status).toBe(403);
    expect(setAllFees).not.toHaveBeenCalled();
  });

  it('authorizes before it parses the body — a bad fee without a session is 401', async () => {
    mocks.getSession.mockResolvedValue(null);

    expect((await putFee({ fee: -1 })).status).toBe(401);
  });

  it.each([
    ['a negative fee', { fee: -1 }],
    ['a fractional fee', { fee: 1500.5 }],
    ['a fee sent as a string', { fee: '30000' }],
    ['a null fee', { fee: null }],
    ['a missing fee', {}],
  ])(
    'rejects %s from an admin with 400 and the fee message, and writes nothing',
    async (_label, body) => {
      mocks.getSession.mockResolvedValue(sessionFor(ROLES.ADMIN));

      const response = await putFee(body);
      const payload = (await response.json()) as ApiResponse<never>;

      expect(response.status).toBe(400);
      expect(payload.status).toBe('error');
      expect(JSON.stringify(payload)).toContain(SHIPPING_FEE_MESSAGE);
      expect(setAllFees).not.toHaveBeenCalled();
    },
  );

  it('sets the fee once for every province and returns the admin list', async () => {
    mocks.getSession.mockResolvedValue(sessionFor(ROLES.ADMIN));
    setAllFees.mockResolvedValue(ROWS);

    const response = await putFee({ fee: 30_000 });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'success', data: ROWS });
    expect(setAllFees).toHaveBeenCalledTimes(1);
    expect(setAllFees).toHaveBeenCalledWith(30_000);
  });

  it('accepts zero — free shipping everywhere', async () => {
    mocks.getSession.mockResolvedValue(sessionFor(ROLES.ADMIN));
    setAllFees.mockResolvedValue([]);

    expect((await putFee({ fee: 0 })).status).toBe(200);
    expect(setAllFees).toHaveBeenCalledWith(0);
  });

  it('is PUT only — the path has no POST alias a form could reach', async () => {
    // The CSRF defences (JSON preflight, SameSite=Lax) rest on there being no
    // simple-request alias, the same constraint the per-province PUT carries.
    mocks.getSession.mockResolvedValue(sessionFor(ROLES.ADMIN));

    const response = await app.request(API_PATHS.ADMIN_PROVINCES_FEE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fee: 30_000 }),
    });

    expect(response.status).toBe(404);
    expect(setAllFees).not.toHaveBeenCalled();
  });
});
