// Writes the demo catalog (./catalog-data.ts) through the DAOs. Run it with
// `pnpm seed-catalog`.
//
// Re-running is safe: categories upsert by slug, products by sku, and a
// product's images are replaced rather than appended. A product an admin
// soft-deleted stays deleted (see `ProductDao.upsertBySku`).
import { CategoryDao } from '@/db/dao/CategoryDao';
import { ProductDao } from '@/db/dao/ProductDao';
import { SEED_CATEGORIES, SEED_PRODUCTS } from '@/db/seed/catalog-data';

export const seedCatalog = async (): Promise<{
  categories: number;
  products: number;
}> => {
  const categoryIdBySlug = new Map<string, string>();
  for (const category of SEED_CATEGORIES) {
    const row = await CategoryDao.upsertBySlug(category);
    categoryIdBySlug.set(row.slug, row.id);
  }

  for (const { categorySlug, imageKeys, ...product } of SEED_PRODUCTS) {
    const categoryId = categoryIdBySlug.get(categorySlug);
    if (!categoryId) {
      throw new Error(
        `Seed product ${product.sku}: no category ${categorySlug}`,
      );
    }

    const row = await ProductDao.upsertBySku({ ...product, categoryId });
    await ProductDao.setImages(row.id, imageKeys);
  }

  return { categories: SEED_CATEGORIES.length, products: SEED_PRODUCTS.length };
};
