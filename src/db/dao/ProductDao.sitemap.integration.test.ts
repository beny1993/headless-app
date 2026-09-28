// Needs a live database — see src/db/test-db.ts. What `sitemap.xml` lists:
// every active product page, family members included.
import { inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { products } from '@/db/schema/catalog';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';

const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));

describe.skipIf(!databaseReachable)('ProductDao.listForSitemap', () => {
  const fx = new OrderFixtures();
  const memberIds: string[] = [];

  afterEach(async () => {
    // Members first: `variant_of` restricts, so a head cannot go while one of
    // its members is still there.
    if (memberIds.length > 0) {
      await testDb.delete(products).where(inArray(products.id, memberIds));
      memberIds.length = 0;
    }
    await fx.cleanup();
  });

  it('lists every active product with its last change, members too, and no inactive one', async () => {
    const category = await fx.category();
    const head = await fx.product(category, { variantLabel: 'لاوندر' });
    const member = await fx.product(category, {
      variantOf: head.id,
      variantLabel: 'اقیانوس',
    });
    memberIds.push(member.id);
    const standalone = await fx.product(category);
    const inactive = await fx.product(category, { isActive: false });

    const listed = new Map(
      (await ProductDao.listForSitemap()).map((row) => [row.slug, row]),
    );

    // A member is its own page with its own price and photo, unlike the
    // storefront grid, which lists only heads.
    for (const row of [head, member, standalone]) {
      expect(listed.get(row.slug)).toEqual({
        slug: row.slug,
        updatedAt: row.updatedAt,
      });
    }
    expect(listed.has(inactive.slug)).toBe(false);
  });
});
