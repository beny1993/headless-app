// DiscountCodeDao against real Postgres — the CHECK constraints, the unique-code
// conflict, the canonical-code normalization, and the atomic `claim` semantics
// (increment, limit, expiry, active). The oversell-class concurrency proof (N
// racing checkouts, exactly M succeed) lives end-to-end in
// create-order.discount.integration.test.ts; here we pin the primitive itself.
import { eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { discountCodes } from '@/db/schema/discounts';
import { DISCOUNT_TYPES } from '@/lib/discount/discount-code';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';

const { DiscountCodeDao } = await importWithDb(
  () => import('@/db/dao/DiscountCodeDao'),
);

const token = () => crypto.randomUUID().slice(0, 8).toUpperCase();

// Drizzle re-wraps the pg DatabaseError, so the SQLSTATE code lives at `.code` or
// at `.cause.code` — the same both-places check the app's own error mappers use
// (create-order's `isUniqueViolation`, admin-products' `pgErrorOf`).
const pgCode = (error: unknown): string | undefined => {
  for (const candidate of [error, (error as { cause?: unknown })?.cause]) {
    const code = (candidate as { code?: unknown } | null | undefined)?.code;
    if (typeof code === 'string') return code;
  }
  return undefined;
};

const expectRejectCode = async (promise: Promise<unknown>, code: string) => {
  const error = await promise.then(
    () => {
      throw new Error('expected the write to be rejected');
    },
    (e: unknown) => e,
  );
  expect(pgCode(error)).toBe(code);
};

describe.skipIf(!databaseReachable)('DiscountCodeDao', () => {
  const codeIds: string[] = [];
  const remember = <T extends { id: string }>(row: T): T => {
    codeIds.push(row.id);
    return row;
  };

  afterEach(async () => {
    if (codeIds.length > 0) {
      await testDb
        .delete(discountCodes)
        .where(inArray(discountCodes.id, codeIds));
      codeIds.length = 0;
    }
  });

  const percent = (over: Record<string, unknown> = {}) =>
    ({
      code: `PCT-${token()}`,
      type: DISCOUNT_TYPES.PERCENT,
      value: 10,
      minOrderAmount: 0,
      isActive: true,
      ...over,
    }) as Parameters<typeof DiscountCodeDao.create>[0];

  const fixed = (over: Record<string, unknown> = {}) =>
    ({
      code: `FIX-${token()}`,
      type: DISCOUNT_TYPES.FIXED,
      value: 50_000,
      minOrderAmount: 0,
      isActive: true,
      ...over,
    }) as Parameters<typeof DiscountCodeDao.create>[0];

  describe('create + normalization', () => {
    it('stores the code canonically (trimmed + upper-cased)', async () => {
      const created = remember(
        await DiscountCodeDao.create(percent({ code: ' save10 ' })),
      );
      expect(created.code).toBe('SAVE10');
      expect(created.usageCount).toBe(0);
    });

    it('finds a code case-insensitively via findByCode', async () => {
      const created = remember(
        await DiscountCodeDao.create(percent({ code: 'SPRING' })),
      );
      const found = await DiscountCodeDao.findByCode(testDb, '  spring ');
      expect(found?.id).toBe(created.id);
    });

    it('returns null for an unknown code', async () => {
      expect(await DiscountCodeDao.findByCode(testDb, 'NO-SUCH')).toBeNull();
    });

    it('refuses a duplicate code (unique), collapsing case', async () => {
      remember(await DiscountCodeDao.create(percent({ code: 'DUP' })));
      await expectRejectCode(
        DiscountCodeDao.create(percent({ code: 'dup' })),
        '23505',
      );
    });
  });

  describe('CHECK constraints (bypass zod: prove the DB itself refuses)', () => {
    const rawInsert = (over: Record<string, unknown>) =>
      testDb
        .insert(discountCodes)
        .values({
          code: `RAW-${token()}`,
          type: DISCOUNT_TYPES.PERCENT,
          value: 10,
          ...over,
        })
        .returning();

    it('rejects a percent value below 1 or above 100', async () => {
      await expectRejectCode(rawInsert({ value: 0 }), '23514');
      await expectRejectCode(rawInsert({ value: 101 }), '23514');
    });

    it('rejects a fixed value of zero', async () => {
      await expectRejectCode(
        rawInsert({ type: DISCOUNT_TYPES.FIXED, value: 0 }),
        '23514',
      );
    });

    it('rejects a negative minimum order amount', async () => {
      await expectRejectCode(rawInsert({ minOrderAmount: -1 }), '23514');
    });

    it('rejects a usage limit of zero', async () => {
      await expectRejectCode(rawInsert({ usageLimit: 0 }), '23514');
    });

    it('rejects a negative usage count', async () => {
      await expectRejectCode(rawInsert({ usageCount: -1 }), '23514');
    });
  });

  describe('claim (atomic conditional increment)', () => {
    const claim = (id: string) =>
      testDb.transaction((tx) => DiscountCodeDao.claim(tx, id));

    it('increments usage_count and returns the fresh row', async () => {
      const created = remember(
        await DiscountCodeDao.create(fixed({ usageLimit: 3 })),
      );
      const claimed = await claim(created.id);
      expect(claimed?.usageCount).toBe(1);
    });

    it('claims until the limit, then returns null (never over the cap)', async () => {
      const created = remember(
        await DiscountCodeDao.create(fixed({ usageLimit: 2 })),
      );
      expect((await claim(created.id))?.usageCount).toBe(1);
      expect((await claim(created.id))?.usageCount).toBe(2);
      expect(await claim(created.id)).toBeNull(); // exhausted
      const [row] = await testDb
        .select()
        .from(discountCodes)
        .where(eq(discountCodes.id, created.id));
      expect(row.usageCount).toBe(2); // never 3
    });

    it('claims unlimited when usage_limit is null', async () => {
      const created = remember(
        await DiscountCodeDao.create(fixed({ usageLimit: null })),
      );
      for (let i = 1; i <= 5; i++) {
        expect((await claim(created.id))?.usageCount).toBe(i);
      }
    });

    it('never claims an inactive code', async () => {
      const created = remember(
        await DiscountCodeDao.create(fixed({ isActive: false })),
      );
      expect(await claim(created.id)).toBeNull();
    });

    it('never claims an expired code', async () => {
      const created = remember(
        await DiscountCodeDao.create(
          fixed({ expiresAt: new Date(Date.now() - 60_000) }),
        ),
      );
      expect(await claim(created.id)).toBeNull();
    });

    it('claims a code whose expiry is in the future', async () => {
      const created = remember(
        await DiscountCodeDao.create(
          fixed({ expiresAt: new Date(Date.now() + 60_000) }),
        ),
      );
      expect((await claim(created.id))?.usageCount).toBe(1);
    });
  });

  describe('setActive + listForAdmin', () => {
    it('toggles is_active and returns the row', async () => {
      const created = remember(await DiscountCodeDao.create(percent()));
      const off = await DiscountCodeDao.setActive(created.id, false);
      expect(off?.isActive).toBe(false);
      const on = await DiscountCodeDao.setActive(created.id, true);
      expect(on?.isActive).toBe(true);
    });

    it('returns null toggling an unknown id', async () => {
      expect(
        await DiscountCodeDao.setActive(crypto.randomUUID(), false),
      ).toBeNull();
    });

    it('lists created codes (includes inactive ones)', async () => {
      const active = remember(await DiscountCodeDao.create(percent()));
      const inactive = remember(
        await DiscountCodeDao.create(fixed({ isActive: false })),
      );
      const all = await DiscountCodeDao.listForAdmin();
      const ids = all.map((c) => c.id);
      expect(ids).toContain(active.id);
      expect(ids).toContain(inactive.id);
    });
  });
});
