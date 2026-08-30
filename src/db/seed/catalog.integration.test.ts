// Needs a live database — see src/db/test-db.ts. The seed data itself is
// checked without one in ./catalog-data.test.ts.
import { inArray } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { productImages, products } from '@/db/schema/catalog';
import { SEED_PRODUCTS } from '@/db/seed/catalog-data';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';

const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));
const { seedCatalog } = await importWithDb(() => import('@/db/seed/catalog'));

const skus = SEED_PRODUCTS.map((product) => product.sku);

describe.skipIf(!databaseReachable)('seedCatalog', () => {
  const seededProducts = () =>
    testDb.select().from(products).where(inArray(products.sku, skus));

  const seededImages = async () => {
    const rows = await seededProducts();
    return testDb
      .select()
      .from(productImages)
      .where(
        inArray(
          productImages.productId,
          rows.map((row) => row.id),
        ),
      );
  };

  beforeAll(async () => {
    await seedCatalog();
  });

  it('inserts every demo product', async () => {
    const rows = await seededProducts();

    expect(rows).toHaveLength(SEED_PRODUCTS.length);
  });

  it('is idempotent — a second run changes no counts and no ids', async () => {
    const before = await seededProducts();
    const imagesBefore = await seededImages();

    await seedCatalog();

    const after = await seededProducts();
    const imagesAfter = await seededImages();

    expect(after).toHaveLength(before.length);
    expect(imagesAfter).toHaveLength(imagesBefore.length);
    // Same rows updated in place, not deleted and recreated — an order item
    // that referenced one of these products would still resolve.
    expect(after.map((row) => row.id).sort()).toEqual(
      before.map((row) => row.id).sort(),
    );
  });

  it('stores Persian titles unchanged, ZWNJ and all', async () => {
    const toy = await ProductDao.getBySlug(
      'smartykat-interactive-feather-bell-toy',
    );

    expect(toy?.title).toBe('اسباب‌بازی تعاملی پر و زنگوله');
    expect(toy?.brand).toBe('SmartyKat');
    expect(toy?.benefit).toBe('تحریک غریزه شکار');
  });

  it('stores prices as the integer Toman the prototype shows', async () => {
    const premium = await ProductDao.getBySlug(
      'royal-canin-adult-cat-dry-food',
    );

    expect(premium?.price).toBe(285_000);
    expect(premium?.oldPrice).toBe(320_000);
  });

  it('gives every seeded product exactly one image', async () => {
    const listed = (await ProductDao.listForAdmin()).filter((row) =>
      skus.includes(row.sku),
    );

    expect(listed).toHaveLength(SEED_PRODUCTS.length);
    for (const product of listed) {
      expect(product.images).toHaveLength(1);
    }
  });

  it('seeds the out-of-stock and low-stock products the design needs', async () => {
    const wet = await ProductDao.getBySlug('sheba-cat-salmon-tuna-wet-food');
    const toy = await ProductDao.getBySlug(
      'smartykat-interactive-feather-bell-toy',
    );

    expect(wet?.stock).toBe(0);
    expect(toy?.stock).toBe(3);
  });

  it('files products under the categories the storefront filters on', async () => {
    const dryFood = await ProductDao.list({ categorySlug: 'dry-food' });
    const dogs = await ProductDao.list({
      categorySlug: 'dry-food',
      petType: 'dog',
    });

    expect(dryFood.map((row) => row.sku).sort()).toEqual(
      ['HS-DOG-CHICKEN-2K', 'RC-CAT-ADULT-1K'].sort(),
    );
    expect(dogs.map((row) => row.sku)).toEqual(['HS-DOG-CHICKEN-2K']);
  });
});
