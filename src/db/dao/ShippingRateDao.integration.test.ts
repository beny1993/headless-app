// Behaviour of ShippingRateDao against a real Postgres. The 1:1 province↔rate
// invariant, upsert idempotency, and the fee >= 0 CHECK cannot be proven against
// a mocked `db`, so this needs a live database (see src/db/test-db.ts). The
// DB-less run collects and skips it cleanly.
//
// Every row is a throwaway province («استان آزمایشی-<token>») cleaned up in
// afterEach — the 31 seeded provinces are never mutated, so the suite is correct
// against the shared dev database and leaves the seed untouched.
import { TransactionRollbackError, eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { provinces, shippingRates } from '@/db/schema/shipping';
import type { Tx } from '@/db/dao/OrderDao';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';

const { ShippingRateDao } = await importWithDb(
  () => import('@/db/dao/ShippingRateDao'),
);

const token = () => crypto.randomUUID().slice(0, 12);

/** Named code points, so a failure reads as «which letter», not two identical glyphs. */
const ARABIC_KAF = '\u0643';
const PERSIAN_KEHEH = '\u06A9';
const NBSP = '\u00A0';
const ZWSP = '\u200B';
const RLM = '\u200F';
const ZWNJ = '\u200C';

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

    it('never reactivates a province the admin deactivated', async () => {
      // The conflict set is `{ name }` only — load-bearing now: a staging re-seed
      // must not undo the admin's deactivation (nor the tuned fee). Read back
      // through the admin lookup, since the storefront one hides inactive rows.
      const seeded = await seedOne(42_000);
      await ShippingRateDao.updateFee(seeded.provinceId, 99_000);
      await ShippingRateDao.setActive(seeded.provinceId, false);

      await ShippingRateDao.upsertProvinceWithRate({
        name: seeded.name,
        fee: 42_000,
      });

      expect(
        await ShippingRateDao.getByProvinceIdForAdmin(seeded.provinceId),
      ).toEqual({ ...seeded, fee: 99_000, isActive: false });
    });

    it('stores the name normalized', async () => {
      const t = token();
      const row = await ShippingRateDao.upsertProvinceWithRate({
        name: ` ${ARABIC_KAF}رمان${NBSP}${NBSP}آزمایشی-${t} `,
        fee: 1,
      });
      createdProvinceIds.push(row.provinceId);

      expect(row.name).toBe(`${PERSIAN_KEHEH}رمان آزمایشی-${t}`);
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

    it('includes an inactive province, flagged — the admin read', async () => {
      const active = await seedOne();
      const inactive = await seedOne();
      await ShippingRateDao.setActive(inactive.provinceId, false);

      const rows = await ShippingRateDao.list();

      expect(rows).toContainEqual({ ...active, isActive: true });
      expect(rows).toContainEqual({ ...inactive, isActive: false });
    });
  });

  describe('listActive', () => {
    it('excludes an inactive province, keeping the storefront shape and id order', async () => {
      const active = await seedOne();
      const inactive = await seedOne();
      await ShippingRateDao.setActive(inactive.provinceId, false);

      const rows = await ShippingRateDao.listActive();
      const ids = rows.map((r) => r.provinceId);

      expect(rows).toContainEqual(active);
      expect(ids).not.toContain(inactive.provinceId);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
      expect(rows.every((r) => !('isActive' in r))).toBe(true);
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

    it('returns null for an inactive province — checkout never prices it', async () => {
      const seeded = await seedOne();
      await ShippingRateDao.setActive(seeded.provinceId, false);

      expect(
        await ShippingRateDao.getByProvinceId(seeded.provinceId),
      ).toBeNull();
    });
  });

  describe('getByProvinceIdForAdmin', () => {
    it('returns an inactive province with its flag', async () => {
      const seeded = await seedOne(50_000);
      await ShippingRateDao.setActive(seeded.provinceId, false);

      expect(
        await ShippingRateDao.getByProvinceIdForAdmin(seeded.provinceId),
      ).toEqual({ ...seeded, isActive: false });
    });

    it('returns null for an unknown id', async () => {
      expect(
        await ShippingRateDao.getByProvinceIdForAdmin(2_147_483_600),
      ).toBeNull();
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
        isActive: true,
      });
    });

    it('succeeds on an inactive province — the admin tunes it before reactivating', async () => {
      const seeded = await seedOne(40_000);
      await ShippingRateDao.setActive(seeded.provinceId, false);

      expect(
        await ShippingRateDao.updateFee(seeded.provinceId, 65_000),
      ).toEqual({ ...seeded, fee: 65_000, isActive: false });
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

  describe('create', () => {
    /** Create a throwaway through `create`, remembered for teardown. */
    const createOne = async (name: string, fee = 30_000) => {
      const row = await ShippingRateDao.create({ name, fee });
      if (row) createdProvinceIds.push(row.provinceId);
      return row;
    };

    const rateCount = async () =>
      (await testDb.select({ id: shippingRates.id }).from(shippingRates))
        .length;

    it('inserts an active province with its rate and returns the admin row', async () => {
      const t = token();
      const row = await createOne(` ${ARABIC_KAF}رمان-آزمایشی-${t} `, 0);

      expect(row).toEqual({
        provinceId: expect.any(Number),
        name: `${PERSIAN_KEHEH}رمان-آزمایشی-${t}`,
        fee: 0,
        isActive: true,
      });
      expect(
        await ShippingRateDao.getByProvinceIdForAdmin(row!.provinceId),
      ).toEqual(row);
    });

    it('returns null on a duplicate name and writes no rate', async () => {
      const existing = await createOne(`استان آزمایشی-${token()}`, 30_000);
      const before = await rateCount();

      expect(await createOne(existing!.name, 99_000)).toBeNull();

      expect(await rateCount()).toBe(before);
      expect(
        (await ShippingRateDao.getByProvinceIdForAdmin(existing!.provinceId))
          ?.fee,
      ).toBe(30_000);
    });

    it('returns null when the existing duplicate is inactive — never reactivates it', async () => {
      const existing = await createOne(`استان آزمایشی-${token()}`);
      await ShippingRateDao.setActive(existing!.provinceId, false);

      expect(await createOne(existing!.name)).toBeNull();
      expect(
        (await ShippingRateDao.getByProvinceIdForAdmin(existing!.provinceId))
          ?.isActive,
      ).toBe(false);
    });

    it('treats the name with an invisible character appended as the same name', async () => {
      const existing = await createOne(`استان آزمایشی-${token()}`);
      const before = await rateCount();

      for (const invisible of [ZWSP, RLM, ZWNJ]) {
        expect(await createOne(`${existing!.name}${invisible}`)).toBeNull();
      }
      expect(await rateCount()).toBe(before);
    });

    it('treats an Arabic-kaf spelling as the same name', async () => {
      const t = token();
      await createOne(`${PERSIAN_KEHEH}رمان-آزمایشی-${t}`);

      expect(await createOne(`${ARABIC_KAF}رمان-آزمایشی-${t}`)).toBeNull();
    });

    it('is atomic — a rate the CHECK refuses leaves no province behind', async () => {
      const name = `استان آزمایشی-${token()}`;

      await expect(ShippingRateDao.create({ name, fee: -1 })).rejects.toThrow();

      const leaked = await testDb
        .select({ id: provinces.id })
        .from(provinces)
        .where(eq(provinces.name, name));
      createdProvinceIds.push(...leaked.map((r) => r.id));
      expect(leaked).toEqual([]);
    });
  });

  describe('findByName', () => {
    it('finds a province by an un-normalized spelling, with its flag', async () => {
      const seeded = await seedOne();
      const [head, tail] = [seeded.name.slice(0, 5), seeded.name.slice(5)];

      // «استان» + NBSP + « آزمایشی-…»: the run collapses to the stored single space.
      expect(
        await ShippingRateDao.findByName(`  ${head}${NBSP}${tail}${NBSP}`),
      ).toEqual({ ...seeded, isActive: true });
    });

    it('returns null for a name nobody has', async () => {
      expect(
        await ShippingRateDao.findByName(`استان ناموجود-${token()}`),
      ).toBeNull();
    });
  });

  describe('setActive', () => {
    it('deactivates and reactivates, returning the admin row each time', async () => {
      const seeded = await seedOne();

      expect(await ShippingRateDao.setActive(seeded.provinceId, false)).toEqual(
        { ...seeded, isActive: false },
      );
      expect(await ShippingRateDao.setActive(seeded.provinceId, true)).toEqual({
        ...seeded,
        isActive: true,
      });
      expect(await ShippingRateDao.getByProvinceId(seeded.provinceId)).toEqual(
        seeded,
      );
    });

    it('returns null for an unknown id', async () => {
      expect(await ShippingRateDao.setActive(2_147_483_600, false)).toBeNull();
    });
  });

  describe('setAllFees', () => {
    // The write touches EVERY rate row, the 31 seeded ones included — shared
    // dev-database state other suites and the running app read. So each case
    // runs inside a transaction it rolls back: no other session ever sees the
    // fees move, and nothing needs restoring.
    const rolledBack = async (run: (tx: Tx) => Promise<void>) => {
      try {
        await testDb.transaction(async (tx) => {
          await run(tx);
          tx.rollback();
        });
      } catch (error) {
        if (!(error instanceof TransactionRollbackError)) throw error;
      }
    };

    it('sets every province to the fee — inactive ones too — and returns the admin list in id order', async () => {
      const active = await seedOne(40_000);
      const inactive = await seedOne(55_000);
      await ShippingRateDao.setActive(inactive.provinceId, false);

      await rolledBack(async (tx) => {
        const rows = await ShippingRateDao.setAllFees(33_000, tx);

        expect(rows.every((row) => row.fee === 33_000)).toBe(true);
        expect(rows.find((r) => r.provinceId === active.provinceId)).toEqual({
          ...active,
          fee: 33_000,
          isActive: true,
        });
        expect(rows.find((r) => r.provinceId === inactive.provinceId)).toEqual({
          ...inactive,
          fee: 33_000,
          isActive: false,
        });
        const ids = rows.map((row) => row.provinceId);
        expect(ids).toEqual([...ids].sort((a, b) => a - b));
        // The list is the table, not a guess: every rate row was rewritten.
        const stored = await tx
          .select({ fee: shippingRates.fee })
          .from(shippingRates);
        expect(stored).toHaveLength(rows.length);
        expect(stored.every((row) => row.fee === 33_000)).toBe(true);
      });

      // Rolled back — the guard this suite's isolation rests on.
      expect(
        (await ShippingRateDao.getByProvinceIdForAdmin(active.provinceId))?.fee,
      ).toBe(40_000);
    });

    it('accepts zero — free shipping everywhere is a valid rate', async () => {
      const seeded = await seedOne(40_000);

      await rolledBack(async (tx) => {
        const rows = await ShippingRateDao.setAllFees(0, tx);
        expect(rows.find((r) => r.provinceId === seeded.provinceId)?.fee).toBe(
          0,
        );
      });
    });

    it('is all-or-nothing — a fee the CHECK refuses changes no province', async () => {
      const seeded = await seedOne(40_000);

      await expect(ShippingRateDao.setAllFees(-1)).rejects.toThrow();

      expect(
        (await ShippingRateDao.getByProvinceIdForAdmin(seeded.provinceId))?.fee,
      ).toBe(40_000);
    });
  });
});
