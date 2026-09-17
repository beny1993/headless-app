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
  type PetType,
} from '@/db/schema/catalog';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import type { ProductInput } from '@/db/dao/ProductDao';

const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));

describe.skipIf(!databaseReachable)('ProductDao', () => {
  // Fixtures are scoped to a throwaway category per test and torn down by id,
  // so running the suite against a seeded dev database leaves the seed intact.
  const createdCategoryIds: string[] = [];

  const makeCategory = async (
    parentId: string | null = null,
  ): Promise<Category> => {
    const [row] = await testDb
      .insert(categories)
      .values({
        title: 'دسته آزمایشی',
        slug: `test-${faker.string.alphanumeric(10).toLowerCase()}`,
        parentId,
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
      petTypes: [PET_TYPES.CAT],
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

  describe('stock concurrency during admin edits', () => {
    it('preserves a checkout reservation when a stale form changes only the title', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(
        makeProduct(category, { stock: 1 }),
      );
      await ProductDao.decrementStock(testDb, product.id, 1);

      const saved = await ProductDao.update(
        product.id,
        { title: 'عنوان تازه', stock: 1 },
        1,
      );

      expect(saved).toMatchObject({ title: 'عنوان تازه', stock: 0 });
    });

    it('rejects a deliberate stock edit after inventory changed, leaving other fields untouched', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(
        makeProduct(category, { stock: 1 }),
      );
      await ProductDao.decrementStock(testDb, product.id, 1);

      await expect(
        ProductDao.update(product.id, { title: 'عنوان تازه', stock: 5 }, 1),
      ).rejects.toMatchObject({ name: 'StockConflictError' });
      const [stored] = await testDb
        .select()
        .from(products)
        .where(eq(products.id, product.id));
      expect(stored).toMatchObject({ title: product.title, stock: 0 });
    });

    it('handles a stock-only no-op and a missing product without writing inventory', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(
        makeProduct(category, { stock: 1 }),
      );
      expect(
        await ProductDao.update(product.id, { stock: 1 }, 1),
      ).toMatchObject({ stock: 1 });
      expect(
        await ProductDao.update(crypto.randomUUID(), { stock: 2 }, 1),
      ).toBeNull();
      expect(
        await ProductDao.update(crypto.randomUUID(), { stock: 1 }, 1),
      ).toBeNull();
    });

    it('applies an intentional stock change when the observed inventory is current', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(
        makeProduct(category, { stock: 1 }),
      );
      expect(
        await ProductDao.update(product.id, { stock: 5 }, 1),
      ).toMatchObject({ stock: 5 });
    });
  });

  describe('list — the storefront read', () => {
    it('returns active products of the requested category', async () => {
      const category = await makeCategory();
      const created = await ProductDao.create(makeProduct(category));

      const { items: rows } = await ProductDao.list({
        categorySlug: category.slug,
      });

      expect(rows.map((row) => row.id)).toEqual([created.id]);
    });

    it('hides soft-deleted products', async () => {
      const category = await makeCategory();
      const kept = await ProductDao.create(makeProduct(category));
      const removed = await ProductDao.create(makeProduct(category));

      await ProductDao.softDelete(removed.id);
      const { items: rows } = await ProductDao.list({
        categorySlug: category.slug,
      });

      expect(rows.map((row) => row.id)).toEqual([kept.id]);
    });

    it('never returns an inactive product even with no filters at all', async () => {
      const category = await makeCategory();
      const removed = await ProductDao.create(makeProduct(category));
      await ProductDao.softDelete(removed.id);

      const { items: rows } = await ProductDao.list();

      expect(rows.map((row) => row.id)).not.toContain(removed.id);
    });

    it('filters by pet type', async () => {
      const category = await makeCategory();
      const cat = await ProductDao.create(
        makeProduct(category, { petTypes: [PET_TYPES.CAT] }),
      );
      const dog = await ProductDao.create(
        makeProduct(category, { petTypes: [PET_TYPES.DOG] }),
      );

      const { items: dogs } = await ProductDao.list({
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
        makeProduct(wanted, { petTypes: [PET_TYPES.DOG] }),
      );
      await ProductDao.create(
        makeProduct(wanted, { petTypes: [PET_TYPES.CAT] }),
      );
      await ProductDao.create(
        makeProduct(other, { petTypes: [PET_TYPES.DOG] }),
      );

      const { items: rows } = await ProductDao.list({
        categorySlug: wanted.slug,
        petType: PET_TYPES.DOG,
      });

      expect(rows.map((row) => row.id)).toEqual([match.id]);
    });

    it('returns nothing for a category slug that does not exist', async () => {
      const { items: rows } = await ProductDao.list({
        categorySlug: 'no-such-category',
      });

      expect(rows).toEqual([]);
    });

    describe('a parent category takes in its sub-categories', () => {
      /** A parent holding one product itself, over a sub holding two. */
      const makeFamily = async () => {
        const parent = await makeCategory();
        const sub = await makeCategory(parent.id);
        const other = await makeCategory();
        return {
          parent,
          sub,
          own: await ProductDao.create(makeProduct(parent)),
          under: [
            await ProductDao.create(makeProduct(sub)),
            await ProductDao.create(
              makeProduct(sub, { petTypes: [PET_TYPES.DOG] }),
            ),
          ],
          elsewhere: await ProductDao.create(makeProduct(other)),
        };
      };

      const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

      it('lists the parent’s own products and every sub-category’s, counted once each', async () => {
        const { parent, own, under } = await makeFamily();

        const { items, total } = await ProductDao.list({
          categorySlug: parent.slug,
        });

        expect(ids(items)).toEqual(ids([own, ...under]));
        expect(total).toBe(3);
      });

      it('lists only its own products under a sub-category’s slug', async () => {
        const { sub, under } = await makeFamily();

        const { items, total } = await ProductDao.list({
          categorySlug: sub.slug,
        });

        expect(ids(items)).toEqual(ids(under));
        expect(total).toBe(2);
      });

      it('narrows the parent’s whole set by pet type', async () => {
        const { parent, under } = await makeFamily();

        const { items, total } = await ProductDao.list({
          categorySlug: parent.slug,
          petType: PET_TYPES.DOG,
        });

        expect(ids(items)).toEqual([under[1].id]);
        expect(total).toBe(1);
      });

      it('does the same on the admin read', async () => {
        const { parent, sub, own, under } = await makeFamily();

        const wide = await ProductDao.pageForAdmin({
          categorySlug: parent.slug,
        });
        const narrow = await ProductDao.pageForAdmin({
          categorySlug: sub.slug,
        });

        expect(ids(wide.items)).toEqual(ids([own, ...under]));
        expect(wide.total).toBe(3);
        expect(ids(narrow.items)).toEqual(ids(under));
        expect(narrow.total).toBe(2);
      });
    });

    it('attaches images in sort order', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));
      await ProductDao.setImages(product.id, [
        'products/second.jpg',
        'products/first.jpg',
      ]);

      const {
        items: [row],
      } = await ProductDao.list({ categorySlug: category.slug });

      expect(row.images.map((image) => image.objectKey)).toEqual([
        'products/second.jpg',
        'products/first.jpg',
      ]);
      expect(row.images.map((image) => image.sortOrder)).toEqual([0, 1]);
    });

    it('returns a product with no images as an empty array, not undefined', async () => {
      const category = await makeCategory();
      await ProductDao.create(makeProduct(category));

      const {
        items: [row],
      } = await ProductDao.list({ categorySlug: category.slug });

      expect(row.images).toEqual([]);
    });
  });

  describe('list — sorting, price range and pagination', () => {
    /**
     * Three products in one throwaway category, priced and dated apart so every
     * ordering below has exactly one correct answer. `createdAt` is set
     * explicitly rather than left to `now()`: two consecutive inserts can share
     * a timestamp, and a newest-first assertion that ties is a flaky test.
     */
    const makeSortableTrio = async () => {
      const category = await makeCategory();
      const at = (day: number) => new Date(Date.UTC(2026, 0, day));
      const [cheapOldest, midNewest, dearMiddle] = await Promise.all([
        testDb
          .insert(products)
          .values({ ...makeProduct(category), price: 50_000, createdAt: at(1) })
          .returning()
          .then(([row]) => row),
        testDb
          .insert(products)
          .values({
            ...makeProduct(category),
            price: 150_000,
            createdAt: at(3),
          })
          .returning()
          .then(([row]) => row),
        testDb
          .insert(products)
          .values({
            ...makeProduct(category),
            price: 250_000,
            createdAt: at(2),
          })
          .returning()
          .then(([row]) => row),
      ]);
      return { category, cheapOldest, midNewest, dearMiddle };
    };

    it('reports a total that counts every match, not just the page', async () => {
      const { category } = await makeSortableTrio();

      const page = await ProductDao.list({
        categorySlug: category.slug,
        limit: 2,
      });

      expect(page.items).toHaveLength(2);
      expect(page.total).toBe(3);
    });

    it('counts through the same filters as the page it describes', async () => {
      // A count that ignores the filters is the classic pagination leak: the
      // storefront would render page links to pages that are always empty.
      const category = await makeCategory();
      const other = await makeCategory();
      await ProductDao.create(
        makeProduct(category, { petTypes: [PET_TYPES.DOG] }),
      );
      await ProductDao.create(
        makeProduct(category, { petTypes: [PET_TYPES.CAT] }),
      );
      await ProductDao.create(
        makeProduct(other, { petTypes: [PET_TYPES.DOG] }),
      );

      const dogs = await ProductDao.list({
        categorySlug: category.slug,
        petType: PET_TYPES.DOG,
      });

      expect(dogs.total).toBe(1);
      expect(dogs.items).toHaveLength(1);
    });

    it('leaves soft-deleted products out of the total as well as the page', async () => {
      const category = await makeCategory();
      await ProductDao.create(makeProduct(category));
      const removed = await ProductDao.create(makeProduct(category));
      await ProductDao.softDelete(removed.id);

      const page = await ProductDao.list({ categorySlug: category.slug });

      expect(page.total).toBe(1);
      expect(page.items.map((row) => row.id)).not.toContain(removed.id);
    });

    it('walks pages without repeating or dropping a product', async () => {
      const { category } = await makeSortableTrio();

      const first = await ProductDao.list({
        categorySlug: category.slug,
        sort: 'price-asc',
        page: 1,
        limit: 2,
      });
      const second = await ProductDao.list({
        categorySlug: category.slug,
        sort: 'price-asc',
        page: 2,
        limit: 2,
      });

      expect(first.items.map((row) => row.price)).toEqual([50_000, 150_000]);
      expect(second.items.map((row) => row.price)).toEqual([250_000]);
      expect(second.total).toBe(3);
    });

    it('returns an empty page past the end while still reporting the total', async () => {
      const { category } = await makeSortableTrio();

      const page = await ProductDao.list({
        categorySlug: category.slug,
        page: 99,
        limit: 2,
      });

      expect(page.items).toEqual([]);
      expect(page.total).toBe(3);
    });

    it('sorts newest first by default', async () => {
      const { category, cheapOldest, midNewest, dearMiddle } =
        await makeSortableTrio();

      const { items } = await ProductDao.list({ categorySlug: category.slug });

      expect(items.map((row) => row.id)).toEqual([
        midNewest.id,
        dearMiddle.id,
        cheapOldest.id,
      ]);
    });

    it('sorts by ascending price', async () => {
      const { category, cheapOldest, midNewest, dearMiddle } =
        await makeSortableTrio();

      const { items } = await ProductDao.list({
        categorySlug: category.slug,
        sort: 'price-asc',
      });

      expect(items.map((row) => row.id)).toEqual([
        cheapOldest.id,
        midNewest.id,
        dearMiddle.id,
      ]);
    });

    it('sorts by descending price', async () => {
      const { category, cheapOldest, midNewest, dearMiddle } =
        await makeSortableTrio();

      const { items } = await ProductDao.list({
        categorySlug: category.slug,
        sort: 'price-desc',
      });

      expect(items.map((row) => row.id)).toEqual([
        dearMiddle.id,
        midNewest.id,
        cheapOldest.id,
      ]);
    });

    it('orders equal prices deterministically, so paging cannot repeat a row', async () => {
      // Inserted in the opposite order to the one expected back: with no
      // tiebreak Postgres returns the two equal prices in heap order — B, then
      // A — and this test fails, which is exactly what it is here to catch.
      // Sorting on price alone lets the same product land on page 1 and page 2.
      const category = await makeCategory();
      const b = await ProductDao.create(
        makeProduct(category, { price: 90_000, sku: 'TIE-B' }),
      );
      const a = await ProductDao.create(
        makeProduct(category, { price: 90_000, sku: 'TIE-A' }),
      );

      const first = await ProductDao.list({
        categorySlug: category.slug,
        sort: 'price-asc',
        page: 1,
        limit: 1,
      });
      const second = await ProductDao.list({
        categorySlug: category.slug,
        sort: 'price-asc',
        page: 2,
        limit: 1,
      });

      expect(first.items.map((row) => row.id)).toEqual([a.id]);
      expect(second.items.map((row) => row.id)).toEqual([b.id]);
    });

    it('filters on a minimum price, inclusively', async () => {
      const { category } = await makeSortableTrio();

      const { items, total } = await ProductDao.list({
        categorySlug: category.slug,
        minPrice: 150_000,
        sort: 'price-asc',
      });

      expect(items.map((row) => row.price)).toEqual([150_000, 250_000]);
      expect(total).toBe(2);
    });

    it('filters on a maximum price, inclusively', async () => {
      const { category } = await makeSortableTrio();

      const { items } = await ProductDao.list({
        categorySlug: category.slug,
        maxPrice: 150_000,
        sort: 'price-asc',
      });

      expect(items.map((row) => row.price)).toEqual([50_000, 150_000]);
    });

    it('applies both ends of the price range together', async () => {
      const { category } = await makeSortableTrio();

      const { items } = await ProductDao.list({
        categorySlug: category.slug,
        minPrice: 100_000,
        maxPrice: 200_000,
      });

      expect(items.map((row) => row.price)).toEqual([150_000]);
    });

    it('returns nothing for an inverted price range rather than throwing', async () => {
      const { category } = await makeSortableTrio();

      const { items, total } = await ProductDao.list({
        categorySlug: category.slug,
        minPrice: 300_000,
        maxPrice: 100_000,
      });

      expect(items).toEqual([]);
      expect(total).toBe(0);
    });

    it('hides an inactive product from every sort and price window there is', async () => {
      const category = await makeCategory();
      const removed = await ProductDao.create(
        makeProduct(category, { price: 70_000 }),
      );
      await ProductDao.softDelete(removed.id);

      const everyWay = await Promise.all(
        (['newest', 'price-asc', 'price-desc'] as const).map((sort) =>
          ProductDao.list({
            categorySlug: category.slug,
            sort,
            minPrice: 1,
            maxPrice: 1_000_000,
          }),
        ),
      );

      for (const page of everyWay) {
        expect(page.items).toEqual([]);
        expect(page.total).toBe(0);
      }
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
      const { items: storefront } = await ProductDao.list({
        categorySlug: category.slug,
      });

      expect(admin.map((row) => row.id).sort()).toEqual(
        [active.id, removed.id].sort(),
      );
      expect(storefront.map((row) => row.id)).toEqual([active.id]);
    });

    it('narrows to inactive-only, and to active-only, on request', async () => {
      const category = await makeCategory();
      const active = await ProductDao.create(makeProduct(category));
      const removed = await ProductDao.create(makeProduct(category));
      await ProductDao.softDelete(removed.id);

      const inCategory = (rows: { categoryId: string; id: string }[]) =>
        rows.filter((row) => row.categoryId === category.id).map((r) => r.id);

      expect(
        inCategory(await ProductDao.listForAdmin({ active: false })),
      ).toEqual([removed.id]);
      expect(
        inCategory(await ProductDao.listForAdmin({ active: true })),
      ).toEqual([active.id]);
    });

    it('filters by category, pet type and a normalized search term', async () => {
      const category = await makeCategory();
      const other = await makeCategory();
      const cat = await ProductDao.create(
        makeProduct(category, {
          title: 'غذای خشک گربه رویال',
          petTypes: [PET_TYPES.CAT],
        }),
      );
      const dog = await ProductDao.create(
        makeProduct(category, { title: 'قلاده سگ', petTypes: [PET_TYPES.DOG] }),
      );
      await ProductDao.create(makeProduct(other));

      const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

      expect(
        ids(await ProductDao.listForAdmin({ categorySlug: category.slug })),
      ).toEqual([cat.id, dog.id].sort());
      expect(
        ids(
          await ProductDao.listForAdmin({
            categorySlug: category.slug,
            petType: PET_TYPES.DOG,
          }),
        ),
      ).toEqual([dog.id]);
      // Arabic yeh in the query still matches the Persian-yeh column (normalized
      // on both sides) — «گربه» typed with the Arabic form.
      expect(
        ids(
          await ProductDao.listForAdmin({
            categorySlug: category.slug,
            search: 'گربه',
          }),
        ),
      ).toEqual([cat.id]);
    });
  });

  describe('pageForAdmin', () => {
    it('slices the admin listing into pages and counts the whole filtered result', async () => {
      const category = await makeCategory();
      const a = await ProductDao.create(makeProduct(category));
      const b = await ProductDao.create(makeProduct(category));
      const c = await ProductDao.create(makeProduct(category));
      await ProductDao.softDelete(a.id);

      const filter = { categorySlug: category.slug, limit: 2 };
      const first = await ProductDao.pageForAdmin({ ...filter, page: 1 });
      const second = await ProductDao.pageForAdmin({ ...filter, page: 2 });
      const past = await ProductDao.pageForAdmin({ ...filter, page: 5 });

      expect([first.total, second.total, past.total]).toEqual([3, 3, 3]);
      expect(first.items).toHaveLength(2);
      expect(second.items).toHaveLength(1);
      expect(past.items).toEqual([]);
      // Page after page is the full listing in its own order (newest first),
      // the soft-deleted product included.
      const all = await ProductDao.listForAdmin({
        categorySlug: category.slug,
      });
      expect([...first.items, ...second.items].map((row) => row.id)).toEqual(
        all.map((row) => row.id),
      );
      expect(all.map((row) => row.id).sort()).toEqual(
        [a.id, b.id, c.id].sort(),
      );
    });

    it('applies the same filters as the full listing', async () => {
      const category = await makeCategory();
      const active = await ProductDao.create(makeProduct(category));
      const removed = await ProductDao.create(makeProduct(category));
      await ProductDao.softDelete(removed.id);

      const page = (active: boolean) =>
        ProductDao.pageForAdmin({
          categorySlug: category.slug,
          active,
          page: 1,
          limit: 10,
        });
      const inactiveOnly = await page(false);
      const activeOnly = await page(true);

      expect(inactiveOnly.items.map((row) => row.id)).toEqual([removed.id]);
      expect(inactiveOnly.total).toBe(1);
      expect(activeOnly.items.map((row) => row.id)).toEqual([active.id]);
      expect(activeOnly.total).toBe(1);
    });
  });

  describe('a product for one pet or both', () => {
    /** cat-only, dog-only and one for both, in one throwaway category. */
    const makePetCatalog = async () => {
      const category = await makeCategory();
      const [cat, dog, both] = await Promise.all([
        ProductDao.create(makeProduct(category, { petTypes: [PET_TYPES.CAT] })),
        ProductDao.create(makeProduct(category, { petTypes: [PET_TYPES.DOG] })),
        ProductDao.create(
          makeProduct(category, {
            petTypes: [PET_TYPES.CAT, PET_TYPES.DOG],
          }),
        ),
      ]);
      return { category, cat, dog, both };
    };

    const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

    it('reads both pets back as an array, not as a string', async () => {
      const category = await makeCategory();

      const product = await ProductDao.create(
        makeProduct(category, { petTypes: [PET_TYPES.CAT, PET_TYPES.DOG] }),
      );

      expect(product.petTypes).toEqual(['cat', 'dog']);
      expect((await ProductDao.findByIdForAdmin(product.id))?.petTypes).toEqual(
        ['cat', 'dog'],
      );
    });

    it('stores a widened selection on the seed path too', async () => {
      // The update branch of the upsert, not the insert: a re-seed that adds a
      // pet to an existing sku must actually write it.
      const category = await makeCategory();
      const input = makeProduct(category, { petTypes: [PET_TYPES.CAT] });

      await ProductDao.upsertBySku(input);
      const second = await ProductDao.upsertBySku({
        ...input,
        petTypes: [PET_TYPES.CAT, PET_TYPES.DOG],
      });

      expect(second.petTypes).toEqual(['cat', 'dog']);
    });

    it('lists a both-pets product under each pet filter, and once without one', async () => {
      const { category, cat, dog, both } = await makePetCatalog();
      const listed = (petType?: PetType) =>
        ProductDao.list({ categorySlug: category.slug, petType });

      const cats = await listed(PET_TYPES.CAT);
      const dogs = await listed(PET_TYPES.DOG);
      const all = await listed();

      expect(ids(cats.items)).toEqual([cat.id, both.id].sort());
      expect(ids(dogs.items)).toEqual([dog.id, both.id].sort());
      expect(ids(all.items)).toEqual([cat.id, dog.id, both.id].sort());
      // The count is the filtered result, so the pager cannot disagree with it.
      expect([cats.total, dogs.total, all.total]).toEqual([2, 2, 3]);
    });

    it('does the same on the admin listing, so no product goes missing there', async () => {
      const { category, cat, dog, both } = await makePetCatalog();
      const listed = (petType?: PetType) =>
        ProductDao.pageForAdmin({ categorySlug: category.slug, petType });

      const cats = await listed(PET_TYPES.CAT);
      const dogs = await listed(PET_TYPES.DOG);
      const all = await listed();

      expect(ids(cats.items)).toEqual([cat.id, both.id].sort());
      expect(ids(dogs.items)).toEqual([dog.id, both.id].sort());
      expect(ids(all.items)).toEqual([cat.id, dog.id, both.id].sort());
      expect([cats.total, dogs.total, all.total]).toEqual([2, 2, 3]);
    });
  });

  describe('findByIdForAdmin', () => {
    it('loads an inactive product the storefront read would hide', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));
      await ProductDao.softDelete(product.id);

      const found = await ProductDao.findByIdForAdmin(product.id);
      expect(found?.id).toBe(product.id);
      expect(found?.isActive).toBe(false);
      // The storefront read of the same slug is null (active-only).
      expect(await ProductDao.getBySlug(product.slug)).toBeNull();
    });

    it('attaches the product images, and returns null for an unknown id', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));
      await ProductDao.setImages(product.id, [
        'uploads/a.jpg',
        'uploads/b.jpg',
      ]);

      const found = await ProductDao.findByIdForAdmin(product.id);
      expect(found?.images.map((i) => i.objectKey)).toEqual([
        'uploads/a.jpg',
        'uploads/b.jpg',
      ]);
      expect(await ProductDao.findByIdForAdmin(faker.string.uuid())).toBeNull();
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

      const { items: rows } = await ProductDao.list({
        categorySlug: category.slug,
      });

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

    it('rejects a product suited to no pet at all', async () => {
      // zod refuses an empty selection too, but the seed and psql bypass it;
      // this is the rule that actually holds.
      const category = await makeCategory();

      const refused = await refusedBy(() =>
        ProductDao.create(makeProduct(category, { petTypes: [] })),
      );

      expect(refused).toBe('products_pet_type_not_empty');
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

  // ── Persian search ────────────────────────────────────────────────────────
  //
  // Two halves, and they are only correct together: the column is normalized on
  // write, and the term is normalized on read with the same function. Either one
  // alone leaves the query and the index disagreeing about which letters exist.
  //
  // Every assertion is scoped to a throwaway category, so a search here cannot
  // pick up a seeded product and the expected row sets stay exact.

  /** The stored text of one product, straight from the column. */
  const storedSearchText = async (id: string): Promise<string> => {
    const [row] = await testDb
      .select({ searchText: products.searchText })
      .from(products)
      .where(eq(products.id, id));
    return row.searchText;
  };

  /**
   * Three products with the shape the real catalog has — a Persian title, a
   * Latin brand, a Persian benefit line — including the ZWNJ that a genuine
   * Persian title carries.
   */
  const makeSearchCatalog = async () => {
    const category = await makeCategory();
    const [catFood, toy, shampoo] = await Promise.all([
      ProductDao.create(
        makeProduct(category, {
          title: 'غذای خشک پرمیوم گربه بالغ',
          brand: 'Royal Canin',
          benefit: 'مناسب گوارش حساس',
          petTypes: [PET_TYPES.CAT],
        }),
      ),
      ProductDao.create(
        makeProduct(category, {
          // U+200C between «اسباب» and «بازی», as the seed has it.
          title: 'اسباب‌بازی تعاملی پر و زنگوله',
          brand: 'Catit',
          benefit: 'تحریک غریزه شکار',
          petTypes: [PET_TYPES.CAT],
        }),
      ),
      ProductDao.create(
        makeProduct(category, {
          title: 'شامپو ضد کک و کنه سگ',
          brand: 'Beaphar',
          benefit: 'پوست حساس',
          petTypes: [PET_TYPES.DOG],
        }),
      ),
    ]);
    return { category, catFood, toy, shampoo };
  };

  /** The ids a search returns, within one throwaway category. */
  const searchIds = async (
    categorySlug: string,
    search: string,
    extra: Parameters<typeof ProductDao.list>[0] = {},
  ) => {
    const { items } = await ProductDao.list({
      categorySlug,
      search,
      ...extra,
    });
    return items.map((row) => row.id);
  };

  describe('search_text — normalized on every write', () => {
    it('stores the title, brand and benefit as one normalized string', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(
        makeProduct(category, {
          title: 'غذای خشک گربه',
          brand: 'Royal Canin',
          benefit: 'گوارش حساس',
        }),
      );

      expect(await storedSearchText(product.id)).toBe(
        'غذای خشک گربه Royal Canin گوارش حساس',
      );
    });

    it('normalizes the Arabic letters a supplier feed arrives with', async () => {
      const category = await makeCategory();
      // «غذاي خشك» — Arabic yeh and Arabic kaf, as pasted from an Arabic-typed
      // catalogue. The column has to hold the Persian letters, or a shopper
      // typing the Persian ones would never reach this row.
      const product = await ProductDao.create(
        makeProduct(category, { title: 'غذاي خشك', brand: null }),
      );

      expect(await storedSearchText(product.id)).toBe('غذای خشک');
    });

    it('turns the title ZWNJ into a space without touching the title itself', async () => {
      const category = await makeCategory();
      const title = 'اسباب‌بازی تعاملی';
      const product = await ProductDao.create(
        makeProduct(category, { title, brand: null, benefit: null }),
      );

      // The source column is the product's name and stays byte-identical; the
      // search column is the index's business.
      expect((await ProductDao.getBySlug(product.slug))?.title).toBe(title);
      expect(await storedSearchText(product.id)).toBe('اسباب بازی تعاملی');
    });

    it('leaves out a null brand and benefit rather than writing «null»', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(
        makeProduct(category, {
          title: 'غذای خشک',
          brand: null,
          benefit: null,
        }),
      );

      expect(await storedSearchText(product.id)).toBe('غذای خشک');
    });

    it('ignores a search_text a caller tries to supply', async () => {
      // The DAO is the only writer of this column. A caller that could set it
      // could hide a product from the search, or plant one in every result.
      const category = await makeCategory();
      const product = await ProductDao.create({
        ...makeProduct(category, { title: 'غذای خشک', brand: null }),
        searchText: 'انتخاب دستی',
      } as ProductInput);

      expect(await storedSearchText(product.id)).toBe('غذای خشک');
    });

    it('recomputes when the title changes', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(
        makeProduct(category, { title: 'غذای خشک', brand: null }),
      );

      await ProductDao.update(product.id, { title: 'شامپو ضد كك' });

      expect(await storedSearchText(product.id)).toBe('شامپو ضد کک');
    });

    it('recomputes when only the brand changes, keeping the title in the text', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(
        makeProduct(category, { title: 'غذای خشک', brand: 'Whiskas' }),
      );

      await ProductDao.update(product.id, { brand: 'Royal Canin' });

      expect(await storedSearchText(product.id)).toBe('غذای خشک Royal Canin');
    });

    it('drops the brand from the text when the brand is cleared', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(
        makeProduct(category, { title: 'غذای خشک', brand: 'Whiskas' }),
      );

      await ProductDao.update(product.id, { brand: null });

      expect(await storedSearchText(product.id)).toBe('غذای خشک');
    });

    it('leaves the text alone when the patch touches nothing searchable', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(
        makeProduct(category, { title: 'غذای خشک', brand: null }),
      );

      await ProductDao.update(product.id, { price: 999_000 });

      expect(await storedSearchText(product.id)).toBe('غذای خشک');
    });

    it('recomputes on the seed path, so a re-run fixes a stale text', async () => {
      // The update branch of the upsert is what a second `pnpm seed-catalog`
      // takes. Miss it and a corrected product title never reaches the index.
      const category = await makeCategory();
      const input = makeProduct(category, { title: 'غذای خشک', brand: null });
      const first = await ProductDao.upsertBySku(input);

      const second = await ProductDao.upsertBySku({
        ...input,
        title: 'غذاي تر',
      });

      expect(second.id).toBe(first.id);
      expect(await storedSearchText(first.id)).toBe('غذای تر');
    });

    it('is stable across a repeated seed of identical data', async () => {
      const category = await makeCategory();
      const input = makeProduct(category, {
        title: 'اسباب‌بازی تعاملی',
        brand: 'Catit',
      });

      const first = await ProductDao.upsertBySku(input);
      const before = await storedSearchText(first.id);
      await ProductDao.upsertBySku(input);

      expect(await storedSearchText(first.id)).toBe(before);
    });
  });

  describe('list — Persian trigram search', () => {
    it('matches a Persian title with the exact words', async () => {
      const { category, catFood } = await makeSearchCatalog();

      expect(await searchIds(category.slug, 'غذای خشک گربه')).toEqual([
        catFood.id,
      ]);
    });

    it('matches a Persian title from a query typed on an Arabic keyboard', async () => {
      // The story's headline case: «غذاي خشك» with Arabic yeh and Arabic kaf.
      // Un-normalized this scores 0.40 against the stored title and misses;
      // normalized on both sides it is the same string.
      const { category, catFood } = await makeSearchCatalog();

      expect(await searchIds(category.slug, 'غذاي خشك گربه')).toEqual([
        catFood.id,
      ]);
    });

    it('still matches a slightly misspelled query', async () => {
      const { category, catFood } = await makeSearchCatalog();

      // «گرب» — the last letter of «گربه» dropped, the typo a real shopper makes.
      expect(await searchIds(category.slug, 'غذای خشک گرب')).toEqual([
        catFood.id,
      ]);
    });

    it('matches through a misspelled Latin brand', async () => {
      const { category, catFood } = await makeSearchCatalog();

      expect(await searchIds(category.slug, 'royal canim')).toEqual([
        catFood.id,
      ]);
    });

    it('matches a brand whatever case it is typed in', async () => {
      const { category, catFood } = await makeSearchCatalog();

      expect(await searchIds(category.slug, 'ROYAL CANIN')).toEqual([
        catFood.id,
      ]);
    });

    it('matches the benefit line, not only the title', async () => {
      const { category, toy } = await makeSearchCatalog();

      expect(await searchIds(category.slug, 'غریزه شکار')).toEqual([toy.id]);
    });

    it('matches a ZWNJ title whether the shopper types ZWNJ or a space', async () => {
      const { category, toy } = await makeSearchCatalog();

      expect(await searchIds(category.slug, 'اسباب‌بازی')).toEqual([toy.id]);
      expect(await searchIds(category.slug, 'اسباب بازی')).toEqual([toy.id]);
    });

    it('matches a Persian-digit title from an ASCII-digit query', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(
        makeProduct(category, {
          title: 'غذای خشک ۲ کیلوگرمی',
          brand: null,
          benefit: null,
        }),
      );

      expect(await searchIds(category.slug, 'غذای خشک 2 کیلوگرمی')).toEqual([
        product.id,
      ]);
    });

    it('returns nothing for a term no product resembles', async () => {
      const { category } = await makeSearchCatalog();

      expect(await searchIds(category.slug, 'قهوه اسپرسو')).toEqual([]);
    });

    it('matches wet food on a dry-food term — the recall this threshold buys', async () => {
      // The deliberate cost of `%>` over a whole term at 0.45, pinned here so it
      // is a decision rather than a surprise. «غذای خشک» and «غذای مرطوب» share
      // «غذای», and a word-similarity band loose enough to forgive the typo the
      // story exists for is also loose enough to reach the neighbouring word.
      //
      // It reads as a near miss on a shop page, not as a wrong answer — and the
      // category and pet filters are the narrowing the shopper actually has. If
      // this ever needs to be tight instead, it is this number that moves, and
      // this test is what will say so.
      const category = await makeCategory();
      const dry = await ProductDao.create(
        makeProduct(category, { title: 'غذای خشک گربه', brand: null }),
      );
      const wet = await ProductDao.create(
        makeProduct(category, { title: 'غذای مرطوب گربه', brand: null }),
      );

      expect((await searchIds(category.slug, 'غذای خشک')).sort()).toEqual(
        [dry.id, wet.id].sort(),
      );
    });

    it('returns nothing for Latin nonsense either', async () => {
      const { category } = await makeSearchCatalog();

      expect(await searchIds(category.slug, 'xyzzy')).toEqual([]);
    });

    it('reads an empty term as no search at all, not as a search that misses', async () => {
      // What a term of nothing but null bytes strips down to. An empty catalog
      // page would be a lie about the shop; the unfiltered listing is honest.
      const { category } = await makeSearchCatalog();

      const { items, total } = await ProductDao.list({
        categorySlug: category.slug,
        search: '',
      });

      expect(items).toHaveLength(3);
      expect(total).toBe(3);
    });

    it('narrows by pet type and search together', async () => {
      const { category, shampoo } = await makeSearchCatalog();

      expect(
        await searchIds(category.slug, 'حساس', { petType: PET_TYPES.DOG }),
      ).toEqual([shampoo.id]);
    });

    it('narrows by category and search together', async () => {
      const { category, catFood } = await makeSearchCatalog();
      const other = await makeCategory();
      await ProductDao.create(
        makeProduct(other, { title: 'غذای خشک گربه بالغ', brand: null }),
      );

      expect(await searchIds(category.slug, 'غذای خشک گربه')).toEqual([
        catFood.id,
      ]);
    });

    it('narrows by price range and search together', async () => {
      const { category } = await makeSearchCatalog();

      const { items } = await ProductDao.list({
        categorySlug: category.slug,
        search: 'حساس',
        maxPrice: 50_000,
      });

      expect(items).toEqual([]);
    });

    it('never returns a soft-deleted product, however well it matches', async () => {
      const { category, catFood } = await makeSearchCatalog();
      await ProductDao.softDelete(catFood.id);

      expect(await searchIds(category.slug, 'غذای خشک گربه')).toEqual([]);
    });

    it('counts the total through the search, not around it', async () => {
      // A total that ignored the term would draw page links to pages that are
      // always empty — the pagination leak, with a search box in front of it.
      const { category } = await makeSearchCatalog();

      const { items, total } = await ProductDao.list({
        categorySlug: category.slug,
        search: 'حساس',
      });

      expect(items).toHaveLength(2);
      expect(total).toBe(2);
    });

    it('pages a search result without repeating a product', async () => {
      const { category } = await makeSearchCatalog();

      const first = await ProductDao.list({
        categorySlug: category.slug,
        search: 'حساس',
        sort: 'price-asc',
        page: 1,
        limit: 1,
      });
      const second = await ProductDao.list({
        categorySlug: category.slug,
        search: 'حساس',
        sort: 'price-asc',
        page: 2,
        limit: 1,
      });

      expect(first.items).toHaveLength(1);
      expect(second.items).toHaveLength(1);
      expect(first.items[0].id).not.toBe(second.items[0].id);
      expect(first.total).toBe(2);
    });

    it('sorts a search result the way the listing is asked to sort', async () => {
      const category = await makeCategory();
      const dear = await ProductDao.create(
        makeProduct(category, {
          title: 'غذای خشک گربه',
          brand: null,
          price: 300_000,
        }),
      );
      const cheap = await ProductDao.create(
        makeProduct(category, {
          title: 'غذای خشک سگ',
          brand: null,
          price: 90_000,
        }),
      );

      expect(
        await searchIds(category.slug, 'غذای خشک', { sort: 'price-asc' }),
      ).toEqual([cheap.id, dear.id]);
      expect(
        await searchIds(category.slug, 'غذای خشک', { sort: 'price-desc' }),
      ).toEqual([dear.id, cheap.id]);
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
        (await ProductDao.list({ categorySlug: category.slug })).items,
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
