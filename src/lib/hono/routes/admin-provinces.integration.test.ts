// Request-level tests for the admin province API, driven through the real Hono
// `app` — so they prove the mount (the `/admin/*` guard runs before these
// handlers) and the whole create/toggle path, not a handler in isolation. Only
// the session lookup is mocked. Needs a live database (src/db/test-db.ts).
//
// Every province here is a throwaway, torn down rates-first (restrict FK); the
// 31 seeded provinces are never mutated.
import { inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROLES } from '@/db/schema/auth';
import { provinces, shippingRates } from '@/db/schema/shipping';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import {
  API_PATHS,
  apiAdminProvincePath,
  apiShippingRatePath,
} from '@/lib/constant/paths';
import type { ApiResponse } from '@/lib/hono/envelope';
import type {
  AdminProvinceResponse,
  ShippingRateResponse,
} from '@/lib/hono/routes/shipping';
import { SHIPPING_FEE_MESSAGE } from '@/lib/shipping/shipping-query';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ isAuthenticatedUser: mocks.getSession }));

const { app } = await importWithDb(() => import('@/lib/hono'));
const { ShippingRateDao } = await importWithDb(
  () => import('@/db/dao/ShippingRateDao'),
);
const {
  PROVINCE_DUPLICATE_MESSAGE,
  PROVINCE_INACTIVE_DUPLICATE_MESSAGE,
  PROVINCE_NOT_FOUND_MESSAGE,
} = await importWithDb(() => import('@/lib/hono/routes/admin-provinces'));

const token = () => crypto.randomUUID().slice(0, 12);
const ARABIC_KAF = '\u0643';
const PERSIAN_KEHEH = '\u06A9';
const NUL = String.fromCharCode(0);
const ZWSP = '\u200B';
const RLM = '\u200F';

const asRole = (role: string) =>
  mocks.getSession.mockResolvedValue({
    user: { id: 'admin-1', email: 'a@example.com', role },
    session: { id: 's1' },
  });
const anon = () => mocks.getSession.mockResolvedValue(null);

const send = (path: string, method: string, body: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const parse = async <T>(response: Response) => ({
  status: response.status,
  body: (await response.json()) as ApiResponse<T>,
});

describe.skipIf(!databaseReachable)('admin province API', () => {
  const createdProvinceIds: number[] = [];

  afterEach(async () => {
    mocks.getSession.mockReset();
    if (createdProvinceIds.length === 0) return;
    await testDb
      .delete(shippingRates)
      .where(inArray(shippingRates.provinceId, createdProvinceIds));
    await testDb
      .delete(provinces)
      .where(inArray(provinces.id, createdProvinceIds));
    createdProvinceIds.length = 0;
  });

  /** A throwaway province straight through the DAO, remembered for teardown. */
  const throwaway = async (name = `استان آزمایشی-${token()}`, fee = 40_000) => {
    const row = await ShippingRateDao.create({ name, fee });
    if (!row) throw new Error(`throwaway name taken: ${name}`);
    createdProvinceIds.push(row.provinceId);
    return row;
  };

  const createProvince = async (body: unknown) => {
    const result = await parse<AdminProvinceResponse>(
      await send(API_PATHS.ADMIN_PROVINCES, 'POST', body),
    );
    if (result.body.status === 'success') {
      createdProvinceIds.push(result.body.data.provinceId);
    }
    return result;
  };

  const toggle = (id: number, body: unknown) =>
    send(apiAdminProvincePath(id), 'PATCH', body);

  const publicList = async () => {
    const { body } = await parse<ShippingRateResponse[]>(
      await app.request(API_PATHS.SHIPPING_RATES),
    );
    if (body.status !== 'success') throw new Error(body.message);
    return body.data;
  };

  describe('authorization', () => {
    it('401s both routes without a session and 403s a customer, writing nothing', async () => {
      const existing = await throwaway();
      const name = `استان آزمایشی-${token()}`;

      anon();
      expect(
        (await send(API_PATHS.ADMIN_PROVINCES, 'POST', { name, fee: 0 }))
          .status,
      ).toBe(401);
      expect(
        (await toggle(existing.provinceId, { isActive: false })).status,
      ).toBe(401);

      asRole(ROLES.CUSTOMER);
      expect(
        (await send(API_PATHS.ADMIN_PROVINCES, 'POST', { name, fee: 0 }))
          .status,
      ).toBe(403);
      expect(
        (await toggle(existing.provinceId, { isActive: false })).status,
      ).toBe(403);

      expect(await ShippingRateDao.findByName(name)).toBeNull();
      expect(
        (await ShippingRateDao.getByProvinceIdForAdmin(existing.provinceId))
          ?.isActive,
      ).toBe(true);
    });
  });

  describe('POST /api/admin/provinces', () => {
    it('creates an active province, normalized, that the public list then offers', async () => {
      asRole(ROLES.ADMIN);
      const t = token();

      const { status, body } = await createProvince({
        name: ` ${ARABIC_KAF}رمان-آزمایشی-${t} `,
        fee: 35_000,
      });

      expect(status).toBe(201);
      if (body.status !== 'success') throw new Error(body.message);
      expect(body.data).toEqual({
        provinceId: expect.any(Number),
        name: `${PERSIAN_KEHEH}رمان-آزمایشی-${t}`,
        fee: 35_000,
        isActive: true,
      });
      const { isActive: _flag, ...publicShape } = body.data;
      expect(await publicList()).toContainEqual(publicShape);
    });

    it('accepts a free (zero) fee', async () => {
      asRole(ROLES.ADMIN);
      const { status } = await createProvince({
        name: `استان آزمایشی-${token()}`,
        fee: 0,
      });
      expect(status).toBe(201);
    });

    it.each([
      ['an empty name', { name: '   ', fee: 1000 }, 'name'],
      [
        'a name of Hangul fillers',
        { name: String.fromCharCode(0x3164, 0x3164), fee: 1000 },
        'name',
      ],
      ['a name with a null byte', { name: `قم${NUL}`, fee: 1000 }, 'name'],
      ['a negative fee', { name: 'قم', fee: -1 }, 'fee'],
      ['a fee sent as a string', { name: 'قم', fee: '1000' }, 'fee'],
      ['a fractional fee', { name: 'قم', fee: 10.5 }, 'fee'],
    ])('400s %s, naming the field', async (_label, requestBody, field) => {
      asRole(ROLES.ADMIN);
      const { status, body } = await createProvince(requestBody);

      expect(status).toBe(400);
      expect(
        body.status === 'error' &&
          body.errors?.some((e) => e.startsWith(`${field}: `)),
      ).toBe(true);
    });

    it.each([
      ['a negative fee', -1],
      ['a fractional fee', 10.5],
      ['a fee sent as a string', '1000'],
    ])('400s %s with the Persian fee message', async (_label, fee) => {
      asRole(ROLES.ADMIN);
      const { status, body } = await createProvince({ name: 'قم', fee });

      expect(status).toBe(400);
      expect(body.status === 'error' && body.errors).toEqual([
        `fee: ${SHIPPING_FEE_MESSAGE}`,
      ]);
    });

    it('409s a name that already exists, in Persian', async () => {
      const existing = await throwaway();
      asRole(ROLES.ADMIN);

      const { status, body } = await createProvince({
        name: existing.name,
        fee: 1,
      });

      expect(status).toBe(409);
      expect(body.status === 'error' && body.message).toBe(
        PROVINCE_DUPLICATE_MESSAGE,
      );
    });

    it.each([
      ['a zero width space', ZWSP],
      ['a right-to-left mark', RLM],
      ['a Hangul filler', String.fromCharCode(0x3164)],
      ['a variation selector', String.fromCharCode(0xfe0f)],
      ['a braille blank', String.fromCharCode(0x2800)],
    ])(
      '409s the existing name with %s appended, creating no look-alike',
      async (_label, invisible) => {
        const existing = await throwaway();
        asRole(ROLES.ADMIN);

        const { status, body } = await createProvince({
          name: `${existing.name}${invisible}`,
          fee: 1,
        });

        expect(status).toBe(409);
        expect(body.status === 'error' && body.message).toBe(
          PROVINCE_DUPLICATE_MESSAGE,
        );
      },
    );

    it('409s a name held by an inactive province, saying so, and leaves it inactive', async () => {
      const existing = await throwaway();
      await ShippingRateDao.setActive(existing.provinceId, false);
      asRole(ROLES.ADMIN);

      const { status, body } = await createProvince({
        name: existing.name,
        fee: 1,
      });

      expect(status).toBe(409);
      expect(body.status === 'error' && body.message).toBe(
        PROVINCE_INACTIVE_DUPLICATE_MESSAGE,
      );
      expect(
        await ShippingRateDao.getByProvinceIdForAdmin(existing.provinceId),
      ).toEqual(existing && { ...existing, isActive: false });
    });

    it('409s an Arabic-kaf spelling of an existing Persian name', async () => {
      const t = token();
      await throwaway(`${PERSIAN_KEHEH}رمان-آزمایشی-${t}`);
      asRole(ROLES.ADMIN);

      const { status } = await createProvince({
        name: `${ARABIC_KAF}رمان-آزمایشی-${t}`,
        fee: 1,
      });

      expect(status).toBe(409);
    });
  });

  describe('PATCH /api/admin/provinces/{id}', () => {
    it('deactivates: gone from the storefront, still priced for the admin, and back on reactivate', async () => {
      const created = await throwaway(undefined, 40_000);
      const { isActive: _flag, ...publicShape } = created;
      asRole(ROLES.ADMIN);

      const off = await parse<AdminProvinceResponse>(
        await toggle(created.provinceId, { isActive: false }),
      );
      expect(off.status).toBe(200);
      expect(off.body.status === 'success' && off.body.data).toEqual({
        ...created,
        isActive: false,
      });

      // The public list and the fee preview no longer know it…
      expect(await publicList()).not.toContainEqual(publicShape);
      expect(
        (
          await app.request(
            `${API_PATHS.SHIPPING_RATES}?province=${created.provinceId}`,
          )
        ).status,
      ).toBe(400);

      // …but the admin can still tune its fee.
      const put = await parse<AdminProvinceResponse>(
        await send(apiShippingRatePath(created.provinceId), 'PUT', {
          fee: 55_000,
        }),
      );
      expect(put.status).toBe(200);
      expect(put.body.status === 'success' && put.body.data).toEqual({
        ...created,
        fee: 55_000,
        isActive: false,
      });

      const on = await toggle(created.provinceId, { isActive: true });
      expect(on.status).toBe(200);
      expect(await publicList()).toContainEqual({
        ...publicShape,
        fee: 55_000,
      });
    });

    it('404s an unknown province id', async () => {
      asRole(ROLES.ADMIN);
      const { status, body } = await parse<AdminProvinceResponse>(
        await toggle(2_147_483_600, { isActive: false }),
      );

      expect(status).toBe(404);
      expect(body.status === 'error' && body.message).toBe(
        PROVINCE_NOT_FOUND_MESSAGE,
      );
    });

    it('400s a non-boolean flag and a malformed id', async () => {
      const created = await throwaway();
      asRole(ROLES.ADMIN);

      expect(
        (await toggle(created.provinceId, { isActive: 'false' })).status,
      ).toBe(400);
      expect((await toggle(created.provinceId, {})).status).toBe(400);
      expect(
        (
          await send(`${API_PATHS.ADMIN_PROVINCES}/abc`, 'PATCH', {
            isActive: false,
          })
        ).status,
      ).toBe(400);
      expect(
        (await ShippingRateDao.getByProvinceIdForAdmin(created.provinceId))
          ?.isActive,
      ).toBe(true);
    });
  });
});
