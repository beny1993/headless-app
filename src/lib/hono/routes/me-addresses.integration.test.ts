// Request-level tests for the owner-scoped address CRUD, driven through the Hono
// app. Only the session lookup is mocked; auth and owner-scoping (an attacker gets
// 404, never another user's address) are the point. Needs a live database.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { databaseReachable, importWithDb } from '@/db/test-db';
import { AccountFixtures } from '@/db/account-test-fixtures';
import { API_PATHS, apiMeAddressPath } from '@/lib/constant/paths';
import type { ApiResponse } from '@/lib/hono/envelope';
import type { AddressResponse } from '@/lib/hono/routes/me-addresses';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ isAuthenticatedUser: mocks.getSession }));

const { app } = await importWithDb(() => import('@/lib/hono'));
const { AddressDao } = await importWithDb(() => import('@/db/dao/AddressDao'));
const { ShippingRateDao } = await importWithDb(
  () => import('@/db/dao/ShippingRateDao'),
);

describe.skipIf(!databaseReachable)('/api/me/addresses', () => {
  const fx = new AccountFixtures();
  afterEach(() => {
    mocks.getSession.mockReset();
    return fx.cleanup();
  });

  const asUser = (id: string) =>
    mocks.getSession.mockResolvedValue({
      user: { id, email: 'c@example.com', role: 'customer' },
      session: { id: 's1' },
    });
  const anon = () => mocks.getSession.mockResolvedValue(null);

  const body = (provinceId: number, over: Record<string, unknown> = {}) => ({
    title: 'خانه',
    recipientName: 'سارا محمدی',
    recipientPhone: '09120000000',
    provinceId,
    city: 'تهران',
    postalCode: '1234567890',
    addressLine: 'خیابان ولیعصر، پلاک ۱۲',
    ...over,
  });

  const post = (b: unknown) =>
    app.request(API_PATHS.ME_ADDRESSES, {
      method: 'POST',
      body: JSON.stringify(b),
      headers: { 'content-type': 'application/json' },
    });
  const patch = (id: string, b: unknown) =>
    app.request(apiMeAddressPath(id), {
      method: 'PATCH',
      body: JSON.stringify(b),
      headers: { 'content-type': 'application/json' },
    });
  const del = (id: string) =>
    app.request(apiMeAddressPath(id), { method: 'DELETE' });

  const seed = async (userId: string, over?: Record<string, unknown>) => {
    const province = await fx.province();
    return AddressDao.create(userId, {
      title: 'خانه',
      recipientName: 'سارا محمدی',
      recipientPhone: '09120000000',
      provinceId: province.id,
      city: 'تهران',
      postalCode: '1234567890',
      addressLine: 'خیابان ولیعصر، پلاک ۱۲',
      ...over,
    });
  };

  describe('auth', () => {
    it('401s every verb without a session', async () => {
      anon();
      expect((await app.request(API_PATHS.ME_ADDRESSES)).status).toBe(401);
      expect((await post(body(1))).status).toBe(401);
      expect((await patch(crypto.randomUUID(), body(1))).status).toBe(401);
      expect((await del(crypto.randomUUID())).status).toBe(401);
    });
  });

  describe('create + list', () => {
    it('creates an address for the session user, joined to its province name', async () => {
      const user = await fx.user();
      const province = await fx.province();
      asUser(user.id);

      const res = await post(body(province.id));
      expect(res.status).toBe(200);
      const payload = (await res.json()) as ApiResponse<AddressResponse>;
      if (payload.status !== 'success') throw new Error(payload.message);
      expect(payload.data.provinceName).toBe(province.name);
      expect(payload.data).not.toHaveProperty('userId');
    });

    it('400s a malformed body (missing province)', async () => {
      const user = await fx.user();
      asUser(user.id);
      const { provinceId: _omit, ...noProvince } = body(1);
      expect((await post(noProvince)).status).toBe(400);
    });

    it('422s a create with a well-formed but unknown province, not a 500', async () => {
      // In int4 range so it passes the schema, but no such province exists — must
      // be a clean 422, never the province_id FK-violation 500 it would become if
      // it reached the insert. (Revert the getByProvinceId guard and this 500s.)
      const user = await fx.user();
      asUser(user.id);
      expect((await post(body(2_000_000_000))).status).toBe(422);
    });

    it('422s an update to a well-formed but unknown province, not a 500', async () => {
      const user = await fx.user();
      const address = await seed(user.id);
      asUser(user.id);
      expect((await patch(address.id, body(2_000_000_000))).status).toBe(422);
    });

    it('422s a create on an inactive province — the shop no longer ships there', async () => {
      const user = await fx.user();
      const province = await fx.province();
      await ShippingRateDao.setActive(province.id, false);
      asUser(user.id);

      expect((await post(body(province.id))).status).toBe(422);
      expect(await AddressDao.listByUser(user.id)).toEqual([]);
    });

    it('422s an update of an address whose province was deactivated, even unchanged', async () => {
      // Decided default: the customer must repick. The storefront warns first;
      // this is the backstop.
      const user = await fx.user();
      const address = await seed(user.id, { city: 'تهران' });
      await ShippingRateDao.setActive(address.provinceId, false);
      asUser(user.id);

      expect(
        (await patch(address.id, body(address.provinceId, { city: 'کرج' })))
          .status,
      ).toBe(422);
      expect((await AddressDao.getOwned(address.id, user.id))?.city).toBe(
        'تهران',
      );
    });
  });

  describe('cross-user isolation (IDOR)', () => {
    it('does not list another user’s addresses', async () => {
      const owner = await fx.user();
      await seed(owner.id);
      const attacker = await fx.user();
      asUser(attacker.id);

      const list = (await (
        await app.request(API_PATHS.ME_ADDRESSES)
      ).json()) as ApiResponse<AddressResponse[]>;
      if (list.status !== 'success') throw new Error(list.message);
      expect(list.data).toEqual([]);
    });

    it('404s an update to another user’s address and leaves it untouched', async () => {
      const owner = await fx.user();
      const address = await seed(owner.id, { city: 'تهران' });
      const attacker = await fx.user();
      asUser(attacker.id);

      expect(
        (await patch(address.id, body(address.provinceId, { city: 'شیراز' })))
          .status,
      ).toBe(404);
      const reread = await AddressDao.getOwned(address.id, owner.id);
      expect(reread?.city).toBe('تهران');
    });

    it('404s a delete of another user’s address and leaves it in place', async () => {
      const owner = await fx.user();
      const address = await seed(owner.id);
      const attacker = await fx.user();
      asUser(attacker.id);

      expect((await del(address.id)).status).toBe(404);
      expect(await AddressDao.getOwned(address.id, owner.id)).not.toBeNull();
    });
  });

  describe('update + delete (owner)', () => {
    it('updates and then deletes the owner’s address', async () => {
      const user = await fx.user();
      const address = await seed(user.id, { city: 'تهران' });
      asUser(user.id);

      const upd = await patch(
        address.id,
        body(address.provinceId, { city: 'کرج' }),
      );
      expect(upd.status).toBe(200);
      const updBody = (await upd.json()) as ApiResponse<AddressResponse>;
      if (updBody.status !== 'success') throw new Error(updBody.message);
      expect(updBody.data.city).toBe('کرج');

      const res = await del(address.id);
      expect(res.status).toBe(200);
      expect(await AddressDao.getOwned(address.id, user.id)).toBeNull();
    });

    it('400s a non-uuid id but 404s an unknown uuid', async () => {
      const user = await fx.user();
      asUser(user.id);
      expect((await del('not-a-uuid')).status).toBe(400);
      expect((await del(crypto.randomUUID())).status).toBe(404);
    });
  });
});
