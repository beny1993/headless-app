// seedShipping against a real Postgres: it writes the actual 31 provinces to the
// shared dev database (which is the point — QA and the checkout need them), so it
// asserts idempotency and fee-preservation without tearing the seed down. The
// DB-less run collects and skips it cleanly.
import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { SEED_PROVINCES } from '@/db/seed/shipping-data';
import { provinces, shippingRates } from '@/db/schema/shipping';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';

const { seedShipping } = await importWithDb(() => import('@/db/seed/shipping'));
const { ShippingRateDao } = await importWithDb(
  () => import('@/db/dao/ShippingRateDao'),
);

const seedNames = SEED_PROVINCES.map((p) => p.name);

describe.skipIf(!databaseReachable)('seedShipping', () => {
  it('inserts all 31 provinces with their rates', async () => {
    const result = await seedShipping();

    expect(result.provinces).toBe(31);
    const names = (
      await testDb.select({ name: provinces.name }).from(provinces)
    ).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(seedNames));
  });

  it('is idempotent — a second run plants no duplicate province or rate', async () => {
    await seedShipping();
    await seedShipping();

    const provinceRows = await testDb
      .select({ id: provinces.id })
      .from(provinces)
      .where(inArray(provinces.name, seedNames));
    expect(provinceRows).toHaveLength(31);

    const rateRows = await testDb
      .select({ id: shippingRates.id })
      .from(shippingRates)
      .where(
        inArray(
          shippingRates.provinceId,
          provinceRows.map((r) => r.id),
        ),
      );
    expect(rateRows).toHaveLength(31);
  });

  it('preserves a fee an admin tuned when the seed re-runs', async () => {
    await seedShipping();
    const [tehran] = await testDb
      .select({ id: provinces.id })
      .from(provinces)
      .where(eq(provinces.name, 'تهران'));

    const original = (await ShippingRateDao.getByProvinceId(tehran.id))?.fee;
    try {
      await ShippingRateDao.updateFee(tehran.id, 123_456);

      await seedShipping();

      const after = await ShippingRateDao.getByProvinceId(tehran.id);
      expect(after?.fee).toBe(123_456);
    } finally {
      // Leave the dev DB's placeholder as the seed intends it.
      if (original !== undefined) {
        await ShippingRateDao.updateFee(tehran.id, original);
      }
    }
  });
});
