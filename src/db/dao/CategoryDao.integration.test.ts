// Needs a live database — see src/db/test-db.ts.
import { faker } from '@faker-js/faker';
import { inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { categories } from '@/db/schema/catalog';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';

const { CategoryDao } = await importWithDb(
  () => import('@/db/dao/CategoryDao'),
);

describe.skipIf(!databaseReachable)('CategoryDao', () => {
  const createdSlugs: string[] = [];

  const slug = () => {
    const value = `test-${faker.string.alphanumeric(10).toLowerCase()}`;
    createdSlugs.push(value);
    return value;
  };

  afterEach(async () => {
    if (createdSlugs.length === 0) return;
    // Test teardown, not an application path.
    await testDb
      .delete(categories)
      .where(inArray(categories.slug, createdSlugs));
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
});
