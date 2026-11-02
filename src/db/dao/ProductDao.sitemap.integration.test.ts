// Needs a live database — see src/db/test-db.ts. What `sitemap.xml` reads:
// every active product page, family members included, and whether a shelf
// lists anything.
import { inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { categories, productCategories, products } from '@/db/schema/catalog';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';

const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));

describe.skipIf(!databaseReachable)('what sitemap.xml reads', () => {
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

  describe('ProductDao.listForSitemap', () => {
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

  describe('ProductDao.hasShelfProducts', () => {
    it('tells a shelf that lists something from one that lists nothing', async () => {
      const stocked = await fx.category();
      await fx.product(stocked);
      // Every product in it switched off: the category stays (its foreign key
      // restricts), and its shelf shows the empty state.
      const emptied = await fx.category();
      await fx.product(emptied, { isActive: false });

      expect(
        await ProductDao.hasShelfProducts({ categorySlug: stocked.slug }),
      ).toBe(true);
      expect(
        await ProductDao.hasShelfProducts({ categorySlug: emptied.slug }),
      ).toBe(false);
      expect(
        await ProductDao.hasShelfProducts({
          categorySlug: 'test-no-such-category',
        }),
      ).toBe(false);
    });

    it('finds a parent shelf stocked only through its sub-category', async () => {
      const parent = await fx.category();
      const [sub] = await testDb
        .insert(categories)
        .values({
          title: 'زیردسته آزمایشی',
          slug: `test-${crypto.randomUUID().slice(0, 12)}`,
          parentId: parent.id,
        })
        .returning();
      fx.categoryIds.push(sub.id);
      await fx.product(sub);

      // The parent's shelf lists its sub-categories' products, so the sitemap
      // must name it although nothing is filed under the parent itself.
      expect(
        await ProductDao.hasShelfProducts({ categorySlug: parent.slug }),
      ).toBe(true);
    });

    it('finds a shelf stocked only by a product filed there as an extra category', async () => {
      const main = await fx.category();
      const extra = await fx.category();
      const product = await fx.product(main);
      // Removed with the product: the junction row cascades from it.
      await testDb
        .insert(productCategories)
        .values({ productId: product.id, categoryId: extra.id });

      expect(
        await ProductDao.hasShelfProducts({ categorySlug: extra.slug }),
      ).toBe(true);
    });
  });
});
