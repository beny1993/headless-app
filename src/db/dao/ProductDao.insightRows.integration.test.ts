// `ProductDao.insightRows`, the admin insights page's product facts. Needs a
// live Postgres (src/db/test-db.ts): the parent title comes through a
// self-join on `categories`, which a mocked `db` cannot check.
import { afterEach, describe, expect, it } from 'vitest';
import { categories } from '@/db/schema/catalog';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';

const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));

describe.skipIf(!databaseReachable)('ProductDao.insightRows', () => {
  const fx = new OrderFixtures();
  afterEach(() => fx.cleanup());

  /** A sub-category under `parent`, removed by the fixtures' teardown. */
  const subCategory = async (parentId: string) => {
    const [row] = await testDb
      .insert(categories)
      .values({
        title: 'زیردسته آزمایشی',
        slug: `test-${crypto.randomUUID().slice(0, 12)}`,
        parentId,
      })
      .returning();
    // Children before parents: the teardown deletes in this list's order.
    fx.categoryIds.unshift(row.id);
    return row;
  };

  it('returns nothing, without a query, for empty lists', async () => {
    expect(await ProductDao.insightRows({ ids: [], slugs: [] })).toEqual([]);
  });

  it('finds products by id or by slug, with their category facts', async () => {
    const top = await fx.category();
    const sub = await subCategory(top.id);
    const byId = await fx.product(top, { stock: 0 });
    const bySlug = await fx.product(sub, {
      petTypes: ['cat', 'dog'],
      variantLabel: '۲ کیلو',
    });
    await fx.product(top); // neither: must not come back

    const rows = await ProductDao.insightRows({
      ids: [byId.id],
      slugs: [bySlug.slug],
    });

    expect(rows.sort((a, b) => a.slug.localeCompare(b.slug))).toEqual(
      [
        {
          id: byId.id,
          slug: byId.slug,
          title: byId.title,
          variantOf: null,
          variantLabel: null,
          stock: 0,
          isActive: true,
          petTypes: ['cat'],
          categoryId: top.id,
          categoryTitle: top.title,
          parentCategoryTitle: null,
        },
        {
          id: bySlug.id,
          slug: bySlug.slug,
          title: bySlug.title,
          variantOf: null,
          variantLabel: '۲ کیلو',
          stock: bySlug.stock,
          isActive: true,
          petTypes: ['cat', 'dog'],
          categoryId: sub.id,
          categoryTitle: sub.title,
          parentCategoryTitle: top.title,
        },
      ].sort((a, b) => a.slug.localeCompare(b.slug)),
    );
  });

  it('includes a deactivated product', async () => {
    const product = await fx.product(await fx.category(), { isActive: false });
    const rows = await ProductDao.insightRows({ ids: [product.id], slugs: [] });
    expect(rows).toEqual([
      expect.objectContaining({ id: product.id, isActive: false }),
    ]);
  });

  it('returns a product matched both ways once', async () => {
    const product = await fx.product(await fx.category());
    const rows = await ProductDao.insightRows({
      ids: [product.id],
      slugs: [product.slug],
    });
    expect(rows).toHaveLength(1);
  });

  it('ignores a slug no product has', async () => {
    expect(
      await ProductDao.insightRows({ ids: [], slugs: ['test-no-such-slug'] }),
    ).toEqual([]);
  });
});
