// Needs a live database — see src/db/test-db.ts.
import { faker } from '@faker-js/faker';
import { inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { categories, products } from '@/db/schema/catalog';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { PET_TYPES } from '@/lib/catalog/product-query';
import { pgErrorOf } from '@/lib/hono/pg-error';

const { CategoryDao } = await importWithDb(
  () => import('@/db/dao/CategoryDao'),
);
const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));

describe.skipIf(!databaseReachable)('CategoryDao', () => {
  const createdSlugs: string[] = [];

  const slug = () => {
    const value = `test-${faker.string.alphanumeric(10).toLowerCase()}`;
    createdSlugs.push(value);
    return value;
  };

  const makeCategory = (sortOrder = 0) =>
    CategoryDao.create({ title: 'دسته آزمایشی', slug: slug(), sortOrder });

  const makeProduct = (categoryId: string) => {
    const token = faker.string.alphanumeric(10).toLowerCase();
    return ProductDao.create({
      title: 'محصول آزمایشی',
      slug: `p-${token}`,
      sku: `SKU-${token.toUpperCase()}`,
      price: 100_000,
      stock: 1,
      categoryId,
      petType: PET_TYPES.CAT,
    });
  };

  const exists = async (id: string) =>
    (await CategoryDao.list()).some((row) => row.id === id);

  afterEach(async () => {
    if (createdSlugs.length === 0) return;
    // Test teardown, not an application path. Products first: the foreign key
    // refuses to drop a category they still reference.
    const ids = (
      await testDb
        .select({ id: categories.id })
        .from(categories)
        .where(inArray(categories.slug, createdSlugs))
    ).map((row) => row.id);
    if (ids.length > 0) {
      await testDb.delete(products).where(inArray(products.categoryId, ids));
      await testDb.delete(categories).where(inArray(categories.id, ids));
    }
    createdSlugs.length = 0;
  });

  it('stores the Persian title exactly as given', async () => {
    const title = 'غذای خشک';

    const created = await CategoryDao.upsertBySlug({ title, slug: slug() });

    expect(created.title).toBe(title);
  });

  it('inserts once, then updates the same row on re-run', async () => {
    const value = slug();

    const first = await CategoryDao.upsertBySlug({
      title: 'اسباب‌بازی',
      slug: value,
      sortOrder: 1,
    });
    const second = await CategoryDao.upsertBySlug({
      title: 'اسباب‌بازی و سرگرمی',
      slug: value,
      sortOrder: 4,
    });

    expect(second.id).toBe(first.id);
    expect(second.title).toBe('اسباب‌بازی و سرگرمی');
    expect(second.sortOrder).toBe(4);
  });

  it('defaults sort order to zero', async () => {
    const created = await CategoryDao.upsertBySlug({
      title: 'بهداشت',
      slug: slug(),
    });

    expect(created.sortOrder).toBe(0);
  });

  it('lists categories by sort order, then title', async () => {
    const last = await CategoryDao.upsertBySlug({
      title: 'ب',
      slug: slug(),
      sortOrder: 900,
    });
    const first = await CategoryDao.upsertBySlug({
      title: 'الف',
      slug: slug(),
      sortOrder: 800,
    });

    const listed = (await CategoryDao.list())
      .filter((row) => createdSlugs.includes(row.slug))
      .map((row) => row.id);

    expect(listed).toEqual([first.id, last.id]);
  });

  describe('create', () => {
    it('inserts a new category and returns the stored row', async () => {
      const value = slug();

      const created = await CategoryDao.create({
        title: 'غذای تر',
        slug: value,
        sortOrder: 3,
      });

      expect(created).toMatchObject({
        title: 'غذای تر',
        slug: value,
        sortOrder: 3,
      });
      expect(await exists(created.id)).toBe(true);
    });

    it('refuses a duplicate slug instead of overwriting the existing row', async () => {
      const value = slug();
      const first = await CategoryDao.create({
        title: 'اول',
        slug: value,
        sortOrder: 1,
      });

      const error = await CategoryDao.create({
        title: 'دوم',
        slug: value,
        sortOrder: 2,
      }).catch((caught: unknown) => caught);

      expect(pgErrorOf(error)).toMatchObject({
        code: '23505',
        constraint: 'categories_slug_unique',
      });
      const [row] = (await CategoryDao.list()).filter((c) => c.id === first.id);
      expect(row).toMatchObject({ title: 'اول', sortOrder: 1 });
    });
  });

  describe('update', () => {
    it('replaces the title, slug and sort order', async () => {
      const created = await makeCategory(1);
      const nextSlug = slug();

      const updated = await CategoryDao.update(created.id, {
        title: 'عنوان تازه',
        slug: nextSlug,
        sortOrder: 7,
      });

      expect(updated).toMatchObject({
        id: created.id,
        title: 'عنوان تازه',
        slug: nextSlug,
        sortOrder: 7,
      });
    });

    it('returns null for an unknown id', async () => {
      expect(
        await CategoryDao.update(faker.string.uuid(), {
          title: 'ناموجود',
          slug: 'no-such-category',
          sortOrder: 0,
        }),
      ).toBeNull();
    });

    it('refuses renaming onto a slug another category holds', async () => {
      const taken = await makeCategory();
      const other = await makeCategory();

      const error = await CategoryDao.update(other.id, {
        title: other.title,
        slug: taken.slug,
        sortOrder: 0,
      }).catch((caught: unknown) => caught);

      expect(pgErrorOf(error)?.code).toBe('23505');
    });
  });

  describe('deleteById', () => {
    it('removes an unreferenced category and returns it', async () => {
      const created = await makeCategory();

      const removed = await CategoryDao.deleteById(created.id);

      expect(removed?.id).toBe(created.id);
      expect(await exists(created.id)).toBe(false);
    });

    it('returns null for an unknown id', async () => {
      expect(await CategoryDao.deleteById(faker.string.uuid())).toBeNull();
    });

    it('is refused by the products foreign key while a product references it', async () => {
      const created = await makeCategory();
      await makeProduct(created.id);

      const error = await CategoryDao.deleteById(created.id).catch(
        (caught: unknown) => caught,
      );

      expect(pgErrorOf(error)).toMatchObject({
        code: '23503',
        constraint: 'products_category_id_categories_id_fk',
      });
      expect(await exists(created.id)).toBe(true);
    });
  });

  describe('countProducts', () => {
    it('counts only the products in that category', async () => {
      const used = await makeCategory();
      const empty = await makeCategory();
      await makeProduct(used.id);

      expect(await CategoryDao.countProducts(used.id)).toBe(1);
      expect(await CategoryDao.countProducts(empty.id)).toBe(0);
    });

    it('counts soft-deleted products too — the foreign key still sees them', async () => {
      const created = await makeCategory();
      await makeProduct(created.id);
      const hidden = await makeProduct(created.id);
      await ProductDao.softDelete(hidden.id);

      expect(await CategoryDao.countProducts(created.id)).toBe(2);
    });
  });
});
