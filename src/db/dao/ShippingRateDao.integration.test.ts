// Behaviour of ShippingRateDao against a real Postgres. The 1:1 province↔rate
// invariant, upsert idempotency, and the fee >= 0 CHECK cannot be proven against
// a mocked `db`, so this needs a live database (see src/db/test-db.ts). The
// DB-less run collects and skips it cleanly.
//
// Every row is a throwaway province («استان آزمایشی-<token>») cleaned up in
// afterEach — the 31 seeded provinces are never mutated, so the suite is correct
// against the shared dev database and leaves the seed untouched.
import { inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { provinces, shippingRates } from '@/db/schema/shipping';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';

const { ShippingRateDao } = await importWithDb(
  () => import('@/db/dao/ShippingRateDao'),
);

const token = () => crypto.randomUUID().slice(0, 12);

describe.skipIf(!databaseReachable)('ShippingRateDao', () => {
  const createdProvinceIds: number[] = [];

  /** A throwaway province + rate, remembered for teardown. */
  const seedOne = async (fee = 40_000) => {
    const row = await ShippingRateDao.upsertProvinceWithRate({
      name: `استان آزمایشی-${token()}`,
      fee,
    });
    createdProvinceIds.push(row.provinceId);
    return row;
  };

  afterEach(async () => {
    if (createdProvinceIds.length === 0) return;
    // Rates first: province_id is a restrict FK, so a province cannot be deleted
    // while its rate row still points at it.
    await testDb
      .delete(shippingRates)
      .where(inArray(shippingRates.provinceId, createdProvinceIds));
    await testDb
      .delete(provinces)
      .where(inArray(provinces.id, createdProvinceIds));
    createdProvinceIds.length = 0;
  });

  describe('upsertProvinceWithRate', () => {
    it('creates a province and its rate, returning the joined row', async () => {
      const row = await seedOne(42_000);

      expect(row.provinceId).toEqual(expect.any(Number));
      expect(row.name).toMatch(/^استان آزمایشی-/);
      expect(row.fee).toBe(42_000);
    });

    it('is idempotent — a second call plants no duplicate', async () => {
      const first = await seedOne(42_000);

      const again = await ShippingRateDao.upsertProvinceWithRate({
        name: first.name,
        fee: 42_000,
      });

      expect(again.provinceId).toBe(first.provinceId);
      const rows = await testDb
        .select()
        .from(provinces)
        .where(inArray(provinces.id, [first.provinceId]));
      expect(rows).toHaveLength(1);
    });

    it('never overwrites a fee an admin has since tuned', async () => {
      // The seed re-runs on every deploy; it must not reset a rate Benyamin set
      // through the admin endpoint. The rate is insert-if-missing, so a re-seed
      // with the original placeholder leaves the tuned value in place.
      const seeded = await seedOne(42_000);
      await ShippingRateDao.updateFee(seeded.provinceId, 99_000);

      const reseeded = await ShippingRateDao.upsertProvinceWithRate({
        name: seeded.name,
        fee: 42_000,
      });

      expect(reseeded.fee).toBe(99_000);
    });
  });

  describe('list', () => {
    it('returns provinces with their fees, ordered by ascending id', async () => {
      await seedOne();
      await seedOne();

      const rows = await ShippingRateDao.list();
      const ids = rows.map((r) => r.provinceId);

      expect(ids).toEqual([...ids].sort((a, b) => a - b));
      expect(rows.every((r) => typeof r.fee === 'number')).toBe(true);
      // Both throwaways are present with the joined shape.
      const mine = rows.filter((r) =>
        createdProvinceIds.includes(r.provinceId),
      );
      expect(mine).toHaveLength(2);
    });
  });

  describe('getByProvinceId', () => {
    it('returns the joined rate for a province that exists', async () => {
      const seeded = await seedOne(50_000);

      const row = await ShippingRateDao.getByProvinceId(seeded.provinceId);

      expect(row).toEqual({
        provinceId: seeded.provinceId,
        name: seeded.name,
        fee: 50_000,
      });
    });

    it('returns null for a province id that does not exist', async () => {
      // A well-formed but unknown id — the route turns this null into its
      // "unknown province" answer.
      expect(await ShippingRateDao.getByProvinceId(2_147_483_600)).toBeNull();
    });
  });

  describe('updateFee', () => {
    it('sets a new fee and returns the updated joined row', async () => {
      const seeded = await seedOne(40_000);

      const updated = await ShippingRateDao.updateFee(
        seeded.provinceId,
        60_000,
      );

      expect(updated).toEqual({
        provinceId: seeded.provinceId,
        name: seeded.name,
        fee: 60_000,
      });
    });

    it('accepts a free (zero) fee', async () => {
      const seeded = await seedOne(40_000);

      const updated = await ShippingRateDao.updateFee(seeded.provinceId, 0);

      expect(updated?.fee).toBe(0);
    });

    it('returns null for a province that does not exist', async () => {
      expect(await ShippingRateDao.updateFee(2_147_483_600, 10_000)).toBeNull();
    });

    it('is refused by the database CHECK for a negative fee', async () => {
      const seeded = await seedOne(40_000);

      await expect(
        ShippingRateDao.updateFee(seeded.provinceId, -1),
      ).rejects.toThrow();
    });
  });
});
