// Needs a live database — see src/db/test-db.ts. `coverImageKeys` is the read
// behind an order's line photos: each product's first photo by `sortOrder`,
// soft-deleted products included (an order outlives its product's listing).
import { afterEach, describe, expect, it } from 'vitest';
import { productImages } from '@/db/schema/catalog';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';

const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));

describe.skipIf(!databaseReachable)('ProductDao.coverImageKeys', () => {
  const fx = new OrderFixtures();
  afterEach(() => fx.cleanup());

  it('maps each product to its first photo by sort order', async () => {
    const category = await fx.category();
    const product = await fx.product(category);
    await testDb.insert(productImages).values([
      { productId: product.id, objectKey: 'uploads/second.jpg', sortOrder: 1 },
      { productId: product.id, objectKey: 'uploads/first.jpg', sortOrder: 0 },
    ]);

    const keys = await ProductDao.coverImageKeys([product.id]);

    expect(keys.get(product.id)).toBe('uploads/first.jpg');
  });

  it('leaves out a product with no photo, and includes a soft-deleted one', async () => {
    const category = await fx.category();
    const bare = await fx.product(category);
    const retired = await fx.product(category, { isActive: false });
    await testDb
      .insert(productImages)
      .values({ productId: retired.id, objectKey: 'uploads/retired.jpg' });

    const keys = await ProductDao.coverImageKeys([bare.id, retired.id]);

    expect(keys.has(bare.id)).toBe(false);
    expect(keys.get(retired.id)).toBe('uploads/retired.jpg');
  });

  it('returns an empty map for an empty id list', async () => {
    expect((await ProductDao.coverImageKeys([])).size).toBe(0);
  });
});
