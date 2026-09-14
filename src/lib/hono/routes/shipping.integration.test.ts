// Request-level tests for the shipping API, driven through the Hono app the way
// app.test.ts and catalog.integration.test.ts do — no handler is called
// directly, so the shared query schema, the DAO, the join and the response
// mapping are all exercised together. The admin guard's session lookup is the
// one thing mocked (its own coverage is in ../middleware/auth.test.ts); the
// authorization *of this endpoint* is pinned here.
//
// Needs a live database (see src/db/test-db.ts). seedShipping runs in beforeAll
// so the suite does not depend on anyone having run the script. Throwaway
// provinces used for writes are cleaned up; the 31 seeded rows are never mutated.
import { inArray } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ROLES } from '@/db/schema/auth';
import { provinces, shippingRates } from '@/db/schema/shipping';
import { SEED_PROVINCES } from '@/db/seed/shipping-data';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { API_PATHS, apiShippingRatePath } from '@/lib/constant/paths';
import type { ApiResponse } from '@/lib/hono/envelope';
import type { ShippingRateResponse } from '@/lib/hono/routes/shipping';
import { SHIPPING_FEE_MESSAGE } from '@/lib/shipping/shipping-query';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ isAuthenticatedUser: mocks.getSession }));

const { app } = await importWithDb(() => import('@/lib/hono'));
const { ShippingRateDao } = await importWithDb(
  () => import('@/db/dao/ShippingRateDao'),
);
const { seedShipping } = await importWithDb(() => import('@/db/seed/shipping'));

const seedNames = SEED_PROVINCES.map((p) => p.name);
const token = () => crypto.randomUUID().slice(0, 12);

const getJson = async <T>(path: string) => {
  const response = await app.request(path);
  return {
    status: response.status,
    body: (await response.json()) as ApiResponse<T>,
  };
};

const getData = async <T>(path: string): Promise<T> => {
  const { status, body } = await getJson<T>(path);
  expect(status).toBe(200);
  if (body.status !== 'success')
    throw new Error(`expected success: ${body.message}`);
  return body.data;
};

const asRole = (role: string) =>
  mocks.getSession.mockResolvedValue({
    user: { id: 'admin-1', email: 'a@example.com', role },
    session: { id: 's1' },
  });

const putRate = (provinceId: number, body: unknown) =>
  app.request(apiShippingRatePath(provinceId), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe.skipIf(!databaseReachable)('shipping API', () => {
  const createdProvinceIds: number[] = [];

  const throwaway = async (fee = 40_000) => {
    const row = await ShippingRateDao.upsertProvinceWithRate({
      name: `استان آزمایشی-${token()}`,
      fee,
    });
    createdProvinceIds.push(row.provinceId);
    return row;
  };

  beforeAll(async () => {
    await seedShipping();
  });

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

  describe('GET /api/shipping/rates', () => {
    it('lists every seeded province with its fee', async () => {
      const rows = await getData<ShippingRateResponse[]>(
        API_PATHS.SHIPPING_RATES,
      );

      expect(rows.map((r) => r.name)).toEqual(
        expect.arrayContaining(seedNames),
      );
      const tehran = rows.find((r) => r.name === 'تهران');
      expect(tehran?.fee).toBe(25_000);
      expect(typeof tehran?.provinceId).toBe('number');
    });

    it('resolves the fee for every one of the 31 provinces by id', async () => {
      // The acceptance criterion "lookup per province" — each seeded province is
      // reachable through ?province= and answers with its own fee.
      const all = await getData<ShippingRateResponse[]>(
        API_PATHS.SHIPPING_RATES,
      );
      const seeded = all.filter((r) => seedNames.includes(r.name));
      expect(seeded).toHaveLength(31);

      for (const province of seeded) {
        const one = await getData<ShippingRateResponse[]>(
          `${API_PATHS.SHIPPING_RATES}?province=${province.provinceId}`,
        );
        expect(one).toEqual([province]);
      }
    });
  });

  describe('GET /api/shipping/rates?province= — unknown province', () => {
    it('answers a well-formed but unknown province with a 400 in Persian', async () => {
      const { status, body } = await getJson<ShippingRateResponse[]>(
        `${API_PATHS.SHIPPING_RATES}?province=2147483600`,
      );

      expect(status).toBe(400);
      expect(body.status).toBe('error');
      if (body.status === 'error') {
        expect(body.message).toMatch(/[؀-ۿ]/);
      }
    });

    it('answers a null byte with 400, not the 500 an unstripped one would cause', async () => {
      const response = await app.request(
        `${API_PATHS.SHIPPING_RATES}?province=%00`,
      );
      expect(response.status).toBe(400);
    });
  });

  describe('PUT /api/shipping/rates/{provinceId} — admin update', () => {
    it('updates a province fee for an admin and echoes the new rate', async () => {
      const created = await throwaway(40_000);
      asRole(ROLES.ADMIN);

      const response = await putRate(created.provinceId, { fee: 72_000 });
      const body = (await response.json()) as ApiResponse<ShippingRateResponse>;

      expect(response.status).toBe(200);
      expect(body.status === 'success' && body.data).toEqual({
        provinceId: created.provinceId,
        name: created.name,
        fee: 72_000,
        isActive: true,
      });
      // Persisted, not just echoed.
      expect(
        (await ShippingRateDao.getByProvinceId(created.provinceId))?.fee,
      ).toBe(72_000);
    });

    it('accepts a free (zero) fee from an admin', async () => {
      const created = await throwaway(40_000);
      asRole(ROLES.ADMIN);

      const response = await putRate(created.provinceId, { fee: 0 });

      expect(response.status).toBe(200);
    });

    it('rejects a non-admin (401 without a session, 403 for a customer)', async () => {
      // The authz-critical case. The middleware has its own coverage; this pins
      // that THIS endpoint actually mounts it.
      const created = await throwaway(40_000);

      mocks.getSession.mockResolvedValue(null);
      expect((await putRate(created.provinceId, { fee: 99_000 })).status).toBe(
        401,
      );

      asRole(ROLES.CUSTOMER);
      expect((await putRate(created.provinceId, { fee: 99_000 })).status).toBe(
        403,
      );

      // And the fee is untouched by either rejected attempt.
      expect(
        (await ShippingRateDao.getByProvinceId(created.provinceId))?.fee,
      ).toBe(40_000);
    });

    it('answers a well-formed but unknown province with 400 for an admin', async () => {
      asRole(ROLES.ADMIN);

      expect((await putRate(2_147_483_600, { fee: 30_000 })).status).toBe(400);
    });

    it('rejects a negative fee from an admin with 400, in Persian', async () => {
      const created = await throwaway(40_000);
      asRole(ROLES.ADMIN);

      const response = await putRate(created.provinceId, { fee: -1 });
      expect(response.status).toBe(400);
      const body = (await response.json()) as ApiResponse<never>;
      expect(body.status === 'error' && body.errors).toEqual([
        `fee: ${SHIPPING_FEE_MESSAGE}`,
      ]);
    });
  });
});
