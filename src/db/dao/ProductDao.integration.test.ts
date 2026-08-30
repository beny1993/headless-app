// Needs a live database — see src/db/test-db.ts. The DAO's surface is checked
// without one in ./ProductDao.test.ts.
import { faker } from '@faker-js/faker';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  categories,
  PET_TYPES,
  productImages,
  products,
  type Category,
  type NewProduct,
} from '@/db/schema/catalog';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';

const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));

describe.skipIf(!databaseReachable)('ProductDao', () => {
  // Fixtures are scoped to a throwaway category per test and torn down by id,
  // so running the suite against a seeded dev database leaves the seed intact.
  const createdCategoryIds: string[] = [];

  const makeCategory = async (): Promise<Category> => {
    const [row] = await testDb
      .insert(categories)
      .values({
        title: 'دسته آزمایشی',
        slug: `test-${faker.string.alphanumeric(10).toLowerCase()}`,
      })
      .returning();
    createdCategoryIds.push(row.id);
    return row;
  };

  const makeProduct = (
    category: Category,
    overrides: Partial<NewProduct> = {},
  ): NewProduct => {
    const token = faker.string.alphanumeric(10).toLowerCase();
    return {
      title: 'محصول آزمایشی',
      slug: `test-${token}`,
      sku: `TEST-${token.toUpperCase()}`,
      price: 100_000,
      stock: 5,
      categoryId: category.id,
      petType: PET_TYPES.CAT,
      ...overrides,
    };
  };

  afterEach(async () => {
    if (createdCategoryIds.length === 0) return;
    // Raw deletes: this is test teardown, not an application path. The DAO
    // deliberately has no hard delete (see the suite above).
    const mine = await testDb
      .select({ id: products.id })
      .from(products)
      .where(inArray(products.categoryId, createdCategoryIds));
    const ids = mine.map((row) => row.id);
    if (ids.length > 0) {
      await testDb
        .delete(productImages)
        .where(inArray(productImages.productId, ids));
      await testDb.delete(products).where(inArray(products.id, ids));
    }
    await testDb
      .delete(categories)
      .where(inArray(categories.id, createdCategoryIds));
    createdCategoryIds.length = 0;
  });

  describe('list — the storefront read', () => {
    it('returns active products of the requested category', async () => {
      const category = await makeCategory();
      const created = await ProductDao.create(makeProduct(category));

      const rows = await ProductDao.list({ categorySlug: category.slug });

      expect(rows.map((row) => row.id)).toEqual([created.id]);
    });

    it('hides soft-deleted products', async () => {
      const category = await makeCategory();
      const kept = await ProductDao.create(makeProduct(category));
      const removed = await ProductDao.create(makeProduct(category));

      await ProductDao.softDelete(removed.id);
      const rows = await ProductDao.list({ categorySlug: category.slug });

      expect(rows.map((row) => row.id)).toEqual([kept.id]);
    });

    it('never returns an inactive product even with no filters at all', async () => {
      const category = await makeCategory();
      const removed = await ProductDao.create(makeProduct(category));
      await ProductDao.softDelete(removed.id);

      const rows = await ProductDao.list();

      expect(rows.map((row) => row.id)).not.toContain(removed.id);
    });

    it('filters by pet type', async () => {
      const category = await makeCategory();
      const cat = await ProductDao.create(
        makeProduct(category, { petType: PET_TYPES.CAT }),
      );
      const dog = await ProductDao.create(
        makeProduct(category, { petType: PET_TYPES.DOG }),
      );

      const dogs = await ProductDao.list({
        categorySlug: category.slug,
        petType: PET_TYPES.DOG,
      });

      expect(dogs.map((row) => row.id)).toEqual([dog.id]);
      expect(dogs.map((row) => row.id)).not.toContain(cat.id);
    });

    it('applies category and pet type together', async () => {
      const wanted = await makeCategory();
      const other = await makeCategory();
      const match = await ProductDao.create(
        makeProduct(wanted, { petType: PET_TYPES.DOG }),
      );
      await ProductDao.create(makeProduct(wanted, { petType: PET_TYPES.CAT }));
      await ProductDao.create(makeProduct(other, { petType: PET_TYPES.DOG }));

      const rows = await ProductDao.list({
        categorySlug: wanted.slug,
        petType: PET_TYPES.DOG,
      });

      expect(rows.map((row) => row.id)).toEqual([match.id]);
    });

    it('returns nothing for a category slug that does not exist', async () => {
      const rows = await ProductDao.list({ categorySlug: 'no-such-category' });

      expect(rows).toEqual([]);
    });

    it('attaches images in sort order', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));
      await ProductDao.setImages(product.id, [
        'products/second.jpg',
        'products/first.jpg',
      ]);

      const [row] = await ProductDao.list({ categorySlug: category.slug });

      expect(row.images.map((image) => image.objectKey)).toEqual([
        'products/second.jpg',
        'products/first.jpg',
      ]);
      expect(row.images.map((image) => image.sortOrder)).toEqual([0, 1]);
    });

    it('returns a product with no images as an empty array, not undefined', async () => {
      const category = await makeCategory();
      await ProductDao.create(makeProduct(category));

      const [row] = await ProductDao.list({ categorySlug: category.slug });

      expect(row.images).toEqual([]);
    });
  });

  describe('getBySlug', () => {
    it('returns the active product with its images', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));
      await ProductDao.setImages(product.id, ['products/only.jpg']);

      const found = await ProductDao.getBySlug(product.slug);

      expect(found?.id).toBe(product.id);
      expect(found?.images.map((image) => image.objectKey)).toEqual([
        'products/only.jpg',
      ]);
    });

    it('returns null once the product is soft-deleted', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));
      await ProductDao.softDelete(product.id);

      expect(await ProductDao.getBySlug(product.slug)).toBeNull();
    });

    it('returns null for an unknown slug', async () => {
      expect(await ProductDao.getBySlug('nothing-here')).toBeNull();
    });
  });

  describe('softDelete', () => {
    it('keeps the row and only flips is_active', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));

      const removed = await ProductDao.softDelete(product.id);
      const stillThere = await testDb
        .select()
        .from(products)
        .where(eq(products.id, product.id));

      expect(removed?.isActive).toBe(false);
      expect(stillThere).toHaveLength(1);
      expect(stillThere[0].sku).toBe(product.sku);
    });

    it('leaves the images attached so an order item can still resolve one', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));
      await ProductDao.setImages(product.id, ['products/kept.jpg']);

      await ProductDao.softDelete(product.id);
      const images = await testDb
        .select()
        .from(productImages)
        .where(eq(productImages.productId, product.id));

      expect(images).toHaveLength(1);
    });

    it('returns null for an unknown id', async () => {
      expect(await ProductDao.softDelete(faker.string.uuid())).toBeNull();
    });

    it('is idempotent', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));

      await ProductDao.softDelete(product.id);
      const second = await ProductDao.softDelete(product.id);

      expect(second?.isActive).toBe(false);
    });
  });

  describe('listForAdmin', () => {
    it('includes soft-deleted products the storefront hides', async () => {
      const category = await makeCategory();
      const active = await ProductDao.create(makeProduct(category));
      const removed = await ProductDao.create(makeProduct(category));
      await ProductDao.softDelete(removed.id);

      const admin = (await ProductDao.listForAdmin()).filter(
        (row) => row.categoryId === category.id,
      );
      const storefront = await ProductDao.list({ categorySlug: category.slug });

      expect(admin.map((row) => row.id).sort()).toEqual(
        [active.id, removed.id].sort(),
      );
      expect(storefront.map((row) => row.id)).toEqual([active.id]);
    });
  });

  describe('update', () => {
    it('changes the fields it is given and leaves the rest alone', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(
        makeProduct(category, { price: 100_000, stock: 5 }),
      );

      const updated = await ProductDao.update(product.id, { price: 120_000 });

      expect(updated?.price).toBe(120_000);
      expect(updated?.stock).toBe(5);
      expect(updated?.sku).toBe(product.sku);
    });

    it('returns null for an unknown id', async () => {
      expect(
        await ProductDao.update(faker.string.uuid(), { price: 1 }),
      ).toBeNull();
    });
  });

  describe('database constraints', () => {
    /**
     * The constraint Postgres refused on, or undefined if it allowed the write.
     * Drizzle wraps driver errors, so the pg error — the one carrying
     * `constraint` — is the `cause`. Naming the constraint pins down *which*
     * rule fired; a message regex would pass on any failure at all.
     */
    const refusedBy = async (
      run: () => Promise<unknown>,
    ): Promise<string | undefined> => {
      try {
        await run();
        return undefined;
      } catch (error) {
        return (error as { cause?: { constraint?: string } }).cause?.constraint;
      }
    };

    it('accepts a stock of zero — an out-of-stock product still lists', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(
        makeProduct(category, { stock: 0 }),
      );

      const rows = await ProductDao.list({ categorySlug: category.slug });

      expect(product.stock).toBe(0);
      expect(rows.map((row) => row.id)).toEqual([product.id]);
    });

    it('rejects a negative stock on insert', async () => {
      const category = await makeCategory();

      const refused = await refusedBy(() =>
        ProductDao.create(makeProduct(category, { stock: -1 })),
      );

      expect(refused).toBe('products_stock_non_negative');
    });

    it('rejects a negative stock on update', async () => {
      // The orders story oversells through `UPDATE … WHERE stock >= qty`; this
      // is the backstop for every other write path.
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));

      const refused = await refusedBy(() =>
        ProductDao.update(product.id, { stock: -1 }),
      );

      expect(refused).toBe('products_stock_non_negative');
    });

    it('rejects a zero price', async () => {
      const category = await makeCategory();

      const refused = await refusedBy(() =>
        ProductDao.create(makeProduct(category, { price: 0 })),
      );

      expect(refused).toBe('products_price_positive');
    });

    it('rejects a negative price', async () => {
      const category = await makeCategory();

      const refused = await refusedBy(() =>
        ProductDao.create(makeProduct(category, { price: -1 })),
      );

      expect(refused).toBe('products_price_positive');
    });

    it('rejects an old price that is not above the price', async () => {
      const category = await makeCategory();

      const refused = await refusedBy(() =>
        ProductDao.create(
          makeProduct(category, { price: 100_000, oldPrice: 90_000 }),
        ),
      );

      expect(refused).toBe('products_old_price_above_price');
    });

    it('surfaces a duplicate sku as an error', async () => {
      const category = await makeCategory();
      const first = await ProductDao.create(makeProduct(category));

      const refused = await refusedBy(() =>
        ProductDao.create(makeProduct(category, { sku: first.sku })),
      );

      expect(refused).toBe('products_sku_unique');
    });

    it('surfaces a duplicate slug as an error', async () => {
      const category = await makeCategory();
      const first = await ProductDao.create(makeProduct(category));

      const refused = await refusedBy(() =>
        ProductDao.create(makeProduct(category, { slug: first.slug })),
      );

      expect(refused).toBe('products_slug_unique');
    });

    it('refuses to drop a category that still has products', async () => {
      const category = await makeCategory();
      await ProductDao.create(makeProduct(category));

      const refused = await refusedBy(() =>
        testDb.delete(categories).where(eq(categories.id, category.id)),
      );

      expect(refused).toBe('products_category_id_categories_id_fk');
    });
  });

  describe('round-tripping the data the storefront actually stores', () => {
    it('returns Persian titles byte-identical, ZWNJ included', async () => {
      const category = await makeCategory();
      // U+200C between «اسباب» and «بازی». Any normalization on write would
      // strip or replace it and break the search story's assumptions.
      const title = 'اسباب‌بازی تعاملی پر و زنگوله';
      const product = await ProductDao.create(
        makeProduct(category, { title, benefit: 'تحریک غریزه شکار' }),
      );

      const found = await ProductDao.getBySlug(product.slug);

      expect(found?.title).toBe(title);
      expect(found?.title).toContain('‌');
      expect([...(found?.title ?? '')]).toEqual([...title]);
    });

    it('round-trips a large Toman price without precision loss', async () => {
      const category = await makeCategory();
      const price = 9_007_199_254_740_991;

      const product = await ProductDao.create(
        makeProduct(category, { price, oldPrice: null }),
      );
      const found = await ProductDao.getBySlug(product.slug);

      expect(found?.price).toBe(price);
      expect(typeof found?.price).toBe('number');
    });

    it('keeps old_price null rather than zero when there is no discount', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));

      const found = await ProductDao.getBySlug(product.slug);

      expect(found?.oldPrice).toBeNull();
    });
  });

  describe('upsertBySku — the seed path', () => {
    it('inserts once and updates thereafter, keeping the same row', async () => {
      const category = await makeCategory();
      const input = makeProduct(category, { price: 100_000 });

      const first = await ProductDao.upsertBySku(input);
      const second = await ProductDao.upsertBySku({ ...input, price: 111_000 });

      expect(second.id).toBe(first.id);
      expect(second.price).toBe(111_000);
      expect(
        await ProductDao.list({ categorySlug: category.slug }),
      ).toHaveLength(1);
    });

    it('does not resurrect a product an admin soft-deleted', async () => {
      // Re-running the seed must not undo a deliberate removal.
      const category = await makeCategory();
      const input = makeProduct(category);
      const product = await ProductDao.upsertBySku(input);
      await ProductDao.softDelete(product.id);

      await ProductDao.upsertBySku(input);

      expect(await ProductDao.getBySlug(product.slug)).toBeNull();
    });
  });

  describe('setImages', () => {
    it('replaces the previous set rather than appending to it', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));

      await ProductDao.setImages(product.id, ['products/old.jpg']);
      await ProductDao.setImages(product.id, ['products/new.jpg']);

      const found = await ProductDao.getBySlug(product.slug);

      expect(found?.images.map((image) => image.objectKey)).toEqual([
        'products/new.jpg',
      ]);
    });

    it('clears every image when given an empty list', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));
      await ProductDao.setImages(product.id, ['products/old.jpg']);

      await ProductDao.setImages(product.id, []);

      expect((await ProductDao.getBySlug(product.slug))?.images).toEqual([]);
    });
  });
});
