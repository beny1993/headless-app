// Request-level tests for the storefront catalog API, driven through the Hono
// app the way `app.test.ts` does — no handler is called directly, so the query
// schema, the DAO and the response mapping are all exercised together.
//
// Needs a live database (see src/db/test-db.ts); the query-validation half of
// these routes runs without one in ./catalog.test.ts.
import { faker } from '@faker-js/faker';
import { inArray } from 'drizzle-orm';
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
import { API_PATHS, apiProductPath } from '@/lib/constant/paths';
import type { ApiResponse } from '@/lib/hono/envelope';
import type {
  CategoryResponse,
  ProductListResponse,
  ProductResponse,
} from '@/lib/hono/routes/catalog';

const { app } = await importWithDb(() => import('@/lib/hono'));
const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));

/** GET through the app and hand back the status with the parsed envelope. */
const getJson = async <T>(path: string) => {
  const response = await app.request(path);
  return {
    status: response.status,
    body: (await response.json()) as ApiResponse<T>,
  };
};

/** GET and assert the success branch, returning `data` narrowed. */
const getData = async <T>(path: string): Promise<T> => {
  const { status, body } = await getJson<T>(path);
  expect(status).toBe(200);
  if (body.status !== 'success') {
    throw new Error(`expected success, got: ${body.message}`);
  }
  return body.data;
};

describe.skipIf(!databaseReachable)('catalog API', () => {
  // Every assertion is scoped to a throwaway category, so the suite is correct
  // against the seeded dev database and leaves the seed untouched.
  const createdCategoryIds: string[] = [];

  const makeCategory = async (sortOrder = 0): Promise<Category> => {
    const [row] = await testDb
      .insert(categories)
      .values({
        title: 'دسته آزمایشی',
        slug: `test-${faker.string.alphanumeric(10).toLowerCase()}`,
        sortOrder,
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

  /** Three products, priced and dated apart so each ordering has one answer. */
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
        .values({ ...makeProduct(category), price: 150_000, createdAt: at(3) })
        .returning()
        .then(([row]) => row),
      testDb
        .insert(products)
        .values({ ...makeProduct(category), price: 250_000, createdAt: at(2) })
        .returning()
        .then(([row]) => row),
    ]);
    return { category, cheapOldest, midNewest, dearMiddle };
  };

  afterEach(async () => {
    if (createdCategoryIds.length === 0) return;
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

  describe('GET /api/categories', () => {
    it('answers with the success envelope', async () => {
      const { status, body } = await getJson<CategoryResponse[]>(
        API_PATHS.CATEGORIES,
      );

      expect(status).toBe(200);
      expect(body.status).toBe('success');
    });

    it('lists the seeded catalog categories', async () => {
      const list = await getData<CategoryResponse[]>(API_PATHS.CATEGORIES);

      expect(list.map((row) => row.slug)).toEqual(
        expect.arrayContaining(['dry-food', 'wet-food', 'toys']),
      );
    });

    it('sorts by the hand-set order the storefront strip renders in', async () => {
      const list = await getData<CategoryResponse[]>(API_PATHS.CATEGORIES);

      const orders = list.map((row) => row.sortOrder);
      expect(orders).toEqual([...orders].sort((a, b) => a - b));
    });

    it('exposes exactly what the nav needs and no timestamps', async () => {
      const [first] = await getData<CategoryResponse[]>(API_PATHS.CATEGORIES);

      expect(Object.keys(first).sort()).toEqual([
        'id',
        'slug',
        'sortOrder',
        'title',
      ]);
    });

    it('includes a category that has no products yet', async () => {
      // The design's category strip shows «بهداشت» before anything is filed
      // under it — a join-driven list would silently drop it.
      const list = await getData<CategoryResponse[]>(API_PATHS.CATEGORIES);

      expect(list.map((row) => row.slug)).toContain('hygiene');
    });
  });

  describe('GET /api/products — filters', () => {
    it('returns the products of one category with a filtered total', async () => {
      const { category } = await makeSortableTrio();

      const page = await getData<ProductListResponse>(
        `${API_PATHS.PRODUCTS}?category=${category.slug}`,
      );

      expect(page.items).toHaveLength(3);
      expect(page.total).toBe(3);
      expect(page.page).toBe(1);
      expect(page.limit).toBe(12);
      expect(page.totalPages).toBe(1);
    });

    it('filters by pet type', async () => {
      const category = await makeCategory();
      await ProductDao.create(
        makeProduct(category, { petType: PET_TYPES.CAT }),
      );
      const dog = await ProductDao.create(
        makeProduct(category, { petType: PET_TYPES.DOG }),
      );

      const page = await getData<ProductListResponse>(
        `${API_PATHS.PRODUCTS}?category=${category.slug}&pet=dog`,
      );

      expect(page.items.map((row) => row.id)).toEqual([dog.id]);
      expect(page.total).toBe(1);
    });

    it('filters on an inclusive price range', async () => {
      const { category } = await makeSortableTrio();

      const page = await getData<ProductListResponse>(
        `${API_PATHS.PRODUCTS}?category=${category.slug}&minPrice=50000&maxPrice=150000&sort=price-asc`,
      );

      expect(page.items.map((row) => row.price)).toEqual([50_000, 150_000]);
      expect(page.total).toBe(2);
    });

    it('returns an empty page for an inverted price range', async () => {
      const { category } = await makeSortableTrio();

      const page = await getData<ProductListResponse>(
        `${API_PATHS.PRODUCTS}?category=${category.slug}&minPrice=300000&maxPrice=1000`,
      );

      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
      expect(page.totalPages).toBe(0);
    });

    it('returns an empty page for a category slug nobody has', async () => {
      const page = await getData<ProductListResponse>(
        `${API_PATHS.PRODUCTS}?category=no-such-category`,
      );

      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
    });
  });

  describe('GET /api/products — sorting', () => {
    it('sorts newest first when no sort is asked for', async () => {
      const { category, cheapOldest, midNewest, dearMiddle } =
        await makeSortableTrio();

      const page = await getData<ProductListResponse>(
        `${API_PATHS.PRODUCTS}?category=${category.slug}`,
      );

      expect(page.items.map((row) => row.id)).toEqual([
        midNewest.id,
        dearMiddle.id,
        cheapOldest.id,
      ]);
    });

    it('sorts by ascending price', async () => {
      const { category } = await makeSortableTrio();

      const page = await getData<ProductListResponse>(
        `${API_PATHS.PRODUCTS}?category=${category.slug}&sort=price-asc`,
      );

      expect(page.items.map((row) => row.price)).toEqual([
        50_000, 150_000, 250_000,
      ]);
    });

    it('sorts by descending price', async () => {
      const { category } = await makeSortableTrio();

      const page = await getData<ProductListResponse>(
        `${API_PATHS.PRODUCTS}?category=${category.slug}&sort=price-desc`,
      );

      expect(page.items.map((row) => row.price)).toEqual([
        250_000, 150_000, 50_000,
      ]);
    });
  });

  describe('GET /api/products — pagination', () => {
    it('slices the result and reports how many pages there are', async () => {
      const { category } = await makeSortableTrio();

      const page = await getData<ProductListResponse>(
        `${API_PATHS.PRODUCTS}?category=${category.slug}&sort=price-asc&limit=2`,
      );

      expect(page.items.map((row) => row.price)).toEqual([50_000, 150_000]);
      expect(page.total).toBe(3);
      expect(page.limit).toBe(2);
      expect(page.totalPages).toBe(2);
    });

    it('returns the next slice on page two, with nothing repeated', async () => {
      const { category } = await makeSortableTrio();

      const first = await getData<ProductListResponse>(
        `${API_PATHS.PRODUCTS}?category=${category.slug}&sort=price-asc&limit=2&page=1`,
      );
      const second = await getData<ProductListResponse>(
        `${API_PATHS.PRODUCTS}?category=${category.slug}&sort=price-asc&limit=2&page=2`,
      );

      expect(second.items.map((row) => row.price)).toEqual([250_000]);
      expect(second.page).toBe(2);
      const ids = [...first.items, ...second.items].map((row) => row.id);
      expect(new Set(ids).size).toBe(3);
    });

    it('answers a page past the end with an empty list, not an error', async () => {
      const { category } = await makeSortableTrio();

      const { status, body } = await getJson<ProductListResponse>(
        `${API_PATHS.PRODUCTS}?category=${category.slug}&limit=2&page=99`,
      );

      expect(status).toBe(200);
      expect(body.status === 'success' && body.data.items).toEqual([]);
      expect(body.status === 'success' && body.data.total).toBe(3);
    });
  });

  describe('GET /api/products — soft-deleted products', () => {
    it('drops an inactive product from the page and the total', async () => {
      const { category, cheapOldest } = await makeSortableTrio();
      await ProductDao.softDelete(cheapOldest.id);

      const page = await getData<ProductListResponse>(
        `${API_PATHS.PRODUCTS}?category=${category.slug}`,
      );

      expect(page.items.map((row) => row.id)).not.toContain(cheapOldest.id);
      expect(page.total).toBe(2);
    });

    it('hides it under every filter and sort combination there is', async () => {
      // The AC is "never returns is_active = false" — not "not by default". Any
      // combination that could reach around the flag is the bug worth catching.
      const category = await makeCategory();
      const removed = await ProductDao.create(
        makeProduct(category, { price: 70_000, petType: PET_TYPES.DOG }),
      );
      await ProductDao.softDelete(removed.id);

      const queries = [
        '',
        '&pet=dog',
        '&pet=cat',
        '&sort=newest',
        '&sort=price-asc',
        '&sort=price-desc',
        '&minPrice=1&maxPrice=99999999',
        '&minPrice=70000&maxPrice=70000',
        '&page=1&limit=48',
      ];

      for (const query of queries) {
        const page = await getData<ProductListResponse>(
          `${API_PATHS.PRODUCTS}?category=${category.slug}${query}`,
        );

        expect(page.items).toEqual([]);
        expect(page.total).toBe(0);
      }
    });
  });

  describe('GET /api/products/{slug}', () => {
    it('returns the product with its images in order', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(
        makeProduct(category, { description: 'توضیح کامل محصول' }),
      );
      await ProductDao.setImages(product.id, [
        'products/first.jpg',
        'products/second.jpg',
      ]);

      const detail = await getData<ProductResponse>(
        apiProductPath(product.slug),
      );

      expect(detail.id).toBe(product.id);
      expect(detail.description).toBe('توضیح کامل محصول');
      expect(detail.images.map((image) => image.objectKey)).toEqual([
        'products/first.jpg',
        'products/second.jpg',
      ]);
      expect(detail.images.map((image) => image.sortOrder)).toEqual([0, 1]);
    });

    it('returns an empty image list rather than omitting the field', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));

      const detail = await getData<ProductResponse>(
        apiProductPath(product.slug),
      );

      expect(detail.images).toEqual([]);
    });

    it('404s an unknown slug in Persian', async () => {
      const { status, body } = await getJson<ProductResponse>(
        apiProductPath('nothing-here-at-all'),
      );

      expect(status).toBe(404);
      expect(body).toEqual({ status: 'error', message: 'محصول یافت نشد' });
    });

    it('404s a soft-deleted product', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));
      await ProductDao.softDelete(product.id);

      const { status } = await getJson<ProductResponse>(
        apiProductPath(product.slug),
      );

      expect(status).toBe(404);
    });

    it('answers a hidden product exactly as it answers a missing one', async () => {
      // Indistinguishable on purpose: a different status, message or timing tell
      // would turn the endpoint into a probe for which SKUs the shop once sold.
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));
      await ProductDao.softDelete(product.id);

      const hidden = await getJson<ProductResponse>(
        apiProductPath(product.slug),
      );
      const missing = await getJson<ProductResponse>(
        apiProductPath('nothing-here-at-all'),
      );

      expect(hidden.status).toBe(missing.status);
      expect(hidden.body).toEqual(missing.body);
    });
  });

  describe('the shape the storefront reads', () => {
    it('serializes an integer Toman price as a JSON number, not a string', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(
        makeProduct(category, { price: 285_000, oldPrice: 320_000 }),
      );

      const detail = await getData<ProductResponse>(
        apiProductPath(product.slug),
      );

      expect(detail.price).toBe(285_000);
      expect(detail.oldPrice).toBe(320_000);
      expect(typeof detail.price).toBe('number');
    });

    it('carries the largest safe Toman price through JSON without drift', async () => {
      // `price` is a bigint column. The DAO hands back a JS number, so nothing
      // bigint reaches JSON.stringify (which would throw) — this pins that the
      // boundary still holds at the top of the safe range, in the list and the
      // detail alike.
      const category = await makeCategory();
      const price = Number.MAX_SAFE_INTEGER;
      const product = await ProductDao.create(makeProduct(category, { price }));

      const detail = await getData<ProductResponse>(
        apiProductPath(product.slug),
      );
      const page = await getData<ProductListResponse>(
        `${API_PATHS.PRODUCTS}?category=${category.slug}`,
      );

      expect(detail.price).toBe(9_007_199_254_740_991);
      expect(page.items[0].price).toBe(9_007_199_254_740_991);
      expect(String(detail.price)).toBe('9007199254740991');
    });

    it('keeps a missing old price null instead of dropping the field', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));

      const detail = await getData<ProductResponse>(
        apiProductPath(product.slug),
      );

      expect(detail.oldPrice).toBeNull();
      expect(detail).toHaveProperty('oldPrice');
    });

    it('never exposes the soft-delete flag or the internal timestamp', async () => {
      // `isActive` is always true here by construction; publishing it invites a
      // client to branch on it and a later bug to ship it as false.
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));

      const detail = await getData<ProductResponse>(
        apiProductPath(product.slug),
      );

      expect(detail).not.toHaveProperty('isActive');
      expect(detail).not.toHaveProperty('updatedAt');
    });

    it('renders created_at as an ISO 8601 string', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(makeProduct(category));

      const detail = await getData<ProductResponse>(
        apiProductPath(product.slug),
      );

      expect(detail.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    });

    it('round-trips a Persian title with its ZWNJ intact', async () => {
      const category = await makeCategory();
      const title = 'اسباب‌بازی تعاملی پر و زنگوله';
      const product = await ProductDao.create(makeProduct(category, { title }));

      const detail = await getData<ProductResponse>(
        apiProductPath(product.slug),
      );

      expect(detail.title).toBe(title);
      expect([...detail.title]).toEqual([...title]);
    });
  });
});

// Regression: a null byte in the slug used to reach Postgres, which rejects
// U+0000 in text parameters - the driver threw and the route answered 500.
// Stripped at the schema, the lookup now misses like any absent slug.
//
// Guarded like every suite in this file: `app` comes from `importWithDb`, which
// hands back `{}` when there is no database, so an unguarded block here fails
// `pnpm test` on a machine with no Docker instead of skipping. The schema-level
// half of this regression runs without a database in ./catalog.test.ts.
describe.skipIf(!databaseReachable)('null bytes in text inputs', () => {
  it('answers 404, not 500, for a slug carrying a null byte', async () => {
    const response = await app.request('/api/products/abc%00def');
    expect(response.status).toBe(404);
  });

  it('answers an empty listing, not 500, for a category carrying one', async () => {
    const response = await app.request('/api/products?category=abc%00def');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { items: unknown[]; total: number };
    };
    expect(body.data.items).toEqual([]);
    expect(body.data.total).toBe(0);
  });
});
