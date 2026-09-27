// Needs a live database — see src/db/test-db.ts.
import { faker } from '@faker-js/faker';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { categories, productCategories, products } from '@/db/schema/catalog';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { PET_TYPES } from '@/lib/catalog/product-query';
import { pgErrorOf } from '@/db/pg-error';

const { CategoryDao, CategoryParentError } = await importWithDb(
  () => import('@/db/dao/CategoryDao'),
);
type CategoryParentError = InstanceType<typeof CategoryParentError>;
const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));

/** A well-formed upload key; no file behind it — the DAO stores keys, not files. */
const UPLOAD_KEY = 'uploads/123e4567-e89b-42d3-a456-426614174000.jpg';

describe.skipIf(!databaseReachable)('CategoryDao', () => {
  const createdSlugs: string[] = [];

  const slug = () => {
    const value = `test-${faker.string.alphanumeric(10).toLowerCase()}`;
    createdSlugs.push(value);
    return value;
  };

  const makeCategory = (sortOrder = 0, parentId: string | null = null) =>
    CategoryDao.create({
      title: 'دسته آزمایشی',
      slug: slug(),
      sortOrder,
      parentId,
    });

  const makeProduct = (categoryId: string) => {
    const token = faker.string.alphanumeric(10).toLowerCase();
    return ProductDao.create({
      title: 'محصول آزمایشی',
      slug: `p-${token}`,
      sku: `SKU-${token.toUpperCase()}`,
      price: 100_000,
      stock: 1,
      categoryId,
      petTypes: [PET_TYPES.CAT],
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

  it('sets the parent on insert but never re-parents on a re-run', async () => {
    // The seed is the only caller, and it must not undo an admin's move.
    const parent = await makeCategory();
    const value = slug();

    const inserted = await CategoryDao.upsertBySlug({
      title: 'شامپو و نظافت',
      slug: value,
      parentId: parent.id,
    });
    await CategoryDao.update(inserted.id, {
      title: inserted.title,
      slug: value,
      sortOrder: 0,
      parentId: null,
    });
    const reseeded = await CategoryDao.upsertBySlug({
      title: 'شامپو و نظافت',
      slug: value,
      parentId: parent.id,
    });

    expect(inserted.parentId).toBe(parent.id);
    expect(reseeded.parentId).toBeNull();
  });

  it('writes the photo on insert and puts it back on a re-run, like the title', async () => {
    // A re-seed restores the demo state: an admin's photo on a seeded category
    // gives way, and a row seeded without one is left with none.
    const value = slug();
    const inserted = await CategoryDao.upsertBySlug({
      title: 'غذای خشک',
      slug: value,
      imageKey: 'products/cat-dry-food.jpg',
    });
    await CategoryDao.update(inserted.id, {
      title: inserted.title,
      slug: value,
      sortOrder: 0,
      parentId: null,
      imageKey: UPLOAD_KEY,
    });
    const reseeded = await CategoryDao.upsertBySlug({
      title: 'غذای خشک',
      slug: value,
      imageKey: 'products/cat-dry-food.jpg',
    });
    const plain = await CategoryDao.upsertBySlug({
      title: 'مالت',
      slug: slug(),
    });

    expect(inserted.imageKey).toBe('products/cat-dry-food.jpg');
    expect(reseeded.imageKey).toBe('products/cat-dry-food.jpg');
    expect(plain.imageKey).toBeNull();
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
    it('stores the photo’s key, and none when the input names none', async () => {
      const withPhoto = await CategoryDao.create({
        title: 'غذای تر',
        slug: slug(),
        sortOrder: 0,
        parentId: null,
        imageKey: UPLOAD_KEY,
      });
      const withoutPhoto = await makeCategory();

      expect(withPhoto.imageKey).toBe(UPLOAD_KEY);
      expect(withoutPhoto.imageKey).toBeNull();
    });

    it('inserts a new category and returns the stored row', async () => {
      const value = slug();

      const created = await CategoryDao.create({
        title: 'غذای تر',
        slug: value,
        sortOrder: 3,
        parentId: null,
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
        parentId: null,
      });

      const error = await CategoryDao.create({
        title: 'دوم',
        slug: value,
        sortOrder: 2,
        parentId: null,
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
        parentId: null,
      });

      expect(updated).toMatchObject({
        id: created.id,
        title: 'عنوان تازه',
        slug: nextSlug,
        sortOrder: 7,
      });
    });

    it('replaces the photo, and clears it when the input omits one', async () => {
      // The whole category is replaced, photo included — the API's PUT rule.
      const created = await CategoryDao.create({
        title: 'غذای تر',
        slug: slug(),
        sortOrder: 0,
        parentId: null,
        imageKey: 'products/cat-wet-food.jpg',
      });
      const fields = {
        title: created.title,
        slug: created.slug,
        sortOrder: 0,
        parentId: null,
      };

      const replaced = await CategoryDao.update(created.id, {
        ...fields,
        imageKey: UPLOAD_KEY,
      });
      const cleared = await CategoryDao.update(created.id, fields);

      expect(replaced?.imageKey).toBe(UPLOAD_KEY);
      expect(cleared?.imageKey).toBeNull();
    });

    it('returns null for an unknown id', async () => {
      expect(
        await CategoryDao.update(faker.string.uuid(), {
          title: 'ناموجود',
          slug: 'no-such-category',
          sortOrder: 0,
          parentId: null,
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
        parentId: null,
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

    it('is refused by the parent foreign key while a sub-category is under it', async () => {
      const parent = await makeCategory();
      await makeCategory(0, parent.id);

      const error = await CategoryDao.deleteById(parent.id).catch(
        (caught: unknown) => caught,
      );

      expect(pgErrorOf(error)).toMatchObject({
        code: '23503',
        constraint: 'categories_parent_id_categories_id_fk',
      });
      expect(await exists(parent.id)).toBe(true);
    });

    it('removes an empty sub-category', async () => {
      const parent = await makeCategory();
      const sub = await makeCategory(0, parent.id);

      expect((await CategoryDao.deleteById(sub.id))?.id).toBe(sub.id);
      expect(await exists(sub.id)).toBe(false);
    });
  });

  describe('parentId', () => {
    it('files a new category under a top-level parent', async () => {
      const parent = await makeCategory();

      const sub = await makeCategory(0, parent.id);

      expect(sub.parentId).toBe(parent.id);
    });

    it('moves a sub-category to another parent and back to top level', async () => {
      const first = await makeCategory();
      const second = await makeCategory();
      const sub = await makeCategory(0, first.id);
      const body = { title: sub.title, slug: sub.slug, sortOrder: 0 };

      const moved = await CategoryDao.update(sub.id, {
        ...body,
        parentId: second.id,
      });
      const promoted = await CategoryDao.update(sub.id, {
        ...body,
        parentId: null,
      });

      expect(moved?.parentId).toBe(second.id);
      expect(promoted?.parentId).toBeNull();
    });

    it('refuses a category as its own parent', async () => {
      const created = await makeCategory();

      const error = await CategoryDao.update(created.id, {
        title: created.title,
        slug: created.slug,
        sortOrder: 0,
        parentId: created.id,
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(CategoryParentError);
      expect((error as CategoryParentError).reason).toBe('self');
    });

    it('refuses an unknown parent rather than letting the foreign key throw', async () => {
      const error = await makeCategory(0, faker.string.uuid()).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(CategoryParentError);
      expect((error as CategoryParentError).reason).toBe('unknown');
    });

    it('refuses a parent that is itself a sub-category — one level only', async () => {
      const parent = await makeCategory();
      const sub = await makeCategory(0, parent.id);

      const error = await makeCategory(0, sub.id).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(CategoryParentError);
      expect((error as CategoryParentError).reason).toBe('nested');
    });

    it('refuses to give a parent to a category that has sub-categories', async () => {
      const parent = await makeCategory();
      await makeCategory(0, parent.id);
      const other = await makeCategory();

      const error = await CategoryDao.update(parent.id, {
        title: parent.title,
        slug: parent.slug,
        sortOrder: 0,
        parentId: other.id,
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(CategoryParentError);
      expect((error as CategoryParentError).reason).toBe('hasChildren');
    });

    it('still answers an unknown category with null, parent or not', async () => {
      const parent = await makeCategory();

      expect(
        await CategoryDao.update(faker.string.uuid(), {
          title: 'ناموجود',
          slug: 'no-such-category',
          sortOrder: 0,
          parentId: parent.id,
        }),
      ).toBeNull();
    });

    it('is refused by the CHECK when a raw write points a row at itself', async () => {
      // C2: the guard above lives in this DAO, so psql and a future migration
      // are covered by the database itself, not by it.
      const created = await makeCategory();

      const error = await testDb
        .update(categories)
        .set({ parentId: created.id })
        .where(eq(categories.id, created.id))
        .catch((caught: unknown) => caught);

      expect(pgErrorOf(error)).toMatchObject({
        code: '23514',
        constraint: 'categories_parent_not_self',
      });
    });
  });

  describe('countChildren', () => {
    it('counts only the sub-categories directly under it', async () => {
      const parent = await makeCategory();
      await makeCategory(0, parent.id);
      await makeCategory(1, parent.id);
      const childless = await makeCategory();

      expect(await CategoryDao.countChildren(parent.id)).toBe(2);
      expect(await CategoryDao.countChildren(childless.id)).toBe(0);
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

    it('counts a product that only has the category as an extra one', async () => {
      // The junction's foreign key refuses the delete for these too, so the
      // refusal's count has to see them or it reads as a bug.
      const primary = await makeCategory();
      const extra = await makeCategory();
      const product = await makeProduct(primary.id);
      await ProductDao.update(product.id, { extraCategoryIds: [extra.id] });

      expect(await CategoryDao.countProducts(extra.id)).toBe(1);
    });

    it('counts a product once even when it is filed there twice over', async () => {
      // The DAO strips the primary from the extras, so only a raw write can
      // build that first row. The *second*, ordinary extra is what makes this
      // discriminate: a join to the junction returns one row per extra, so it
      // would count this one product twice under its own primary — and the
      // 409 would tell the admin to move two products that do not exist.
      const category = await makeCategory();
      const alsoIn = await makeCategory();
      const product = await makeProduct(category.id);
      await testDb.insert(productCategories).values([
        { productId: product.id, categoryId: category.id },
        { productId: product.id, categoryId: alsoIn.id, sortOrder: 1 },
      ]);

      expect(await CategoryDao.countProducts(category.id)).toBe(1);
      expect(await CategoryDao.countProducts(alsoIn.id)).toBe(1);
    });
  });
});
