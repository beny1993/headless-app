// Migration 0011 plants the 31 provinces in every environment — production
// included, where `pnpm seed-shipping` cannot run. It is hand-written SQL with a
// rule in it (skip a province that already exists, even under another spelling),
// so it gets tests like any other logic.
//
// The file itself is checked without a database. What the statement DOES needs
// Postgres, and runs in a throwaway schema: copies of the two tables, with
// `search_path` pointed at them, inside a transaction that is always rolled
// back. The migration's unqualified `"provinces"` then resolves to the copy, so
// the real rows are never read, locked or changed — and the suite does not care
// what the dev database already holds. Raw SQL appears here only because a
// migration cannot be exercised any other way.
//
// This lives beside the seed data it is pinned to, not in src/db/migrations/:
// that folder is copied whole into the production image.
import { readFileSync } from 'node:fs';
import { TransactionRollbackError, asc, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Tx } from '@/db/dao/OrderDao';
import { provinces, shippingRates } from '@/db/schema/shipping';
import { SEED_PROVINCES } from '@/db/seed/shipping-data';
import { databaseReachable, testDb } from '@/db/test-db';
import { normalizeProvinceName } from '@/lib/shipping/province-input';

// Relative to the repo root, where vitest runs: under happy-dom `import.meta.url`
// is not a file: URL.
const MIGRATION = readFileSync(
  'src/db/migrations/0011_seed_provinces.sql',
  'utf8',
);

const ZWNJ = String.fromCharCode(0x200c);
/** Format characters (ZWNJ, ZWSP, bidi marks…) and NBSP — built, never typed. */
const INVISIBLE = new RegExp(`[\\p{Cf}${String.fromCharCode(0xa0)}]`, 'u');

describe('migration 0011 — the file', () => {
  it('lists exactly the seed provinces, in seed order, in their stored form', () => {
    // The migration is applied history: if the seed's placeholder fees ever
    // change, do NOT edit the migration — drop `fee` from this comparison.
    const rows = [
      ...MIGRATION.matchAll(/^\s*\((\d+), '([^']+)', (\d+)\),?$/gm),
    ];

    expect(rows.map(([, ord]) => Number(ord))).toEqual(
      SEED_PROVINCES.map((_, index) => index + 1),
    );
    expect(rows.map(([, , name, fee]) => ({ name, fee: Number(fee) }))).toEqual(
      SEED_PROVINCES.map(({ name, fee }) => ({
        name: normalizeProvinceName(name),
        fee,
      })),
    );
  });

  it('carries no invisible character — ZWNJ is constructed with chr(8204)', () => {
    // Invisible in review, and in a province name a look-alike of the real one.
    expect(MIGRATION).not.toMatch(INVISIBLE);
    expect(MIGRATION).toContain('chr(8204)');
  });
});

describe.skipIf(!databaseReachable)('migration 0011 — the statement', () => {
  /** Runs `run` against empty copies of the two tables; nothing is ever committed. */
  const inScratchSchema = async (run: (tx: Tx) => Promise<void>) => {
    try {
      await testDb.transaction(async (tx) => {
        await tx.execute(sql.raw('CREATE SCHEMA migration_0011_probe'));
        for (const table of ['provinces', 'shipping_rates']) {
          await tx.execute(
            sql.raw(
              `CREATE TABLE migration_0011_probe.${table} (LIKE public.${table} INCLUDING ALL)`,
            ),
          );
        }
        await tx.execute(
          sql.raw('SET LOCAL search_path TO migration_0011_probe'),
        );
        await run(tx);
        tx.rollback();
      });
    } catch (error) {
      if (!(error instanceof TransactionRollbackError)) throw error;
    }
  };

  const migrate = (tx: Tx) => tx.execute(sql.raw(MIGRATION));

  /** Every province with its rate (null when it has none), in id order. */
  const stored = (tx: Tx) =>
    tx
      .select({
        name: provinces.name,
        isActive: provinces.isActive,
        fee: shippingRates.fee,
      })
      .from(provinces)
      .leftJoin(shippingRates, eq(shippingRates.provinceId, provinces.id))
      .orderBy(asc(provinces.id));

  /** A province the admin typed in by hand, before the migration ran. */
  const handTyped = async (
    tx: Tx,
    input: { name: string; fee: number; isActive?: boolean },
  ) => {
    const [province] = await tx
      .insert(provinces)
      .values({ name: input.name, isActive: input.isActive ?? true })
      .returning({ id: provinces.id });
    await tx
      .insert(shippingRates)
      .values({ provinceId: province.id, fee: input.fee });
  };

  it('fills an empty database with all 31 — active, priced, id order = seed order', async () => {
    await inScratchSchema(async (tx) => {
      await migrate(tx);

      expect(await stored(tx)).toEqual(
        SEED_PROVINCES.map((province) => ({ ...province, isActive: true })),
      );
    });
  });

  it('is idempotent — a second run adds nothing', async () => {
    await inScratchSchema(async (tx) => {
      await migrate(tx);
      await migrate(tx);

      expect(await stored(tx)).toHaveLength(SEED_PROVINCES.length);
    });
  });

  it('keeps a hand-typed province exactly as the admin left it — name, fee and flag', async () => {
    await inScratchSchema(async (tx) => {
      await handTyped(tx, { name: 'قم', fee: 1, isActive: false });

      await migrate(tx);

      const rows = await stored(tx);
      expect(rows).toHaveLength(SEED_PROVINCES.length);
      // First in, first listed: it keeps its id, the rest follow in seed order.
      expect(rows[0]).toEqual({ name: 'قم', fee: 1, isActive: false });
      expect(rows[1].name).toBe('تهران');
    });
  });

  it.each([
    ['an extra space', 'چهار محال و بختیاری', 'چهارمحال و بختیاری'],
    ['a ZWNJ for the space', `آذربایجان${ZWNJ}شرقی`, 'آذربایجان شرقی'],
    ['no space at all', 'خراسانرضوی', 'خراسان رضوی'],
  ])(
    'recognises a province hand-typed with %s, rather than adding its look-alike',
    async (_label, typed, seeded) => {
      await inScratchSchema(async (tx) => {
        await handTyped(tx, { name: typed, fee: 99_999 });

        await migrate(tx);

        const rows = await stored(tx);
        expect(rows).toHaveLength(SEED_PROVINCES.length);
        expect(rows.map((row) => row.name)).not.toContain(seeded);
        expect(rows[0]).toEqual({ name: typed, fee: 99_999, isActive: true });
      });
    },
  );

  it('leaves a province that is not one of the 31 alone', async () => {
    await inScratchSchema(async (tx) => {
      await handTyped(tx, { name: 'کیش', fee: 70_000 });

      await migrate(tx);

      const rows = await stored(tx);
      expect(rows).toHaveLength(SEED_PROVINCES.length + 1);
      expect(rows[0]).toEqual({ name: 'کیش', fee: 70_000, isActive: true });
    });
  });
});
