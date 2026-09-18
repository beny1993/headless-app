// Writes the demo catalog (./catalog-data.ts) through the DAOs. Run it with
// `pnpm seed-catalog`.
//
// Re-running is safe: categories upsert by slug, products by sku, and a
// product's images are replaced rather than appended. A product an admin
// soft-deleted stays deleted (see `ProductDao.upsertBySku`).
import { CategoryDao } from '@/db/dao/CategoryDao';
import { ProductDao } from '@/db/dao/ProductDao';
import {
  SEED_CATEGORIES,
  SEED_PRODUCTS,
  SEED_SUBCATEGORIES,
} from '@/db/seed/catalog-data';

export const seedCatalog = async (): Promise<{
  categories: number;
  products: number;
}> => {
  const categoryIdBySlug = new Map<string, string>();
  const idFor = (slug: string, sku: string) => {
    const id = categoryIdBySlug.get(slug);
    if (!id) throw new Error(`Seed product ${sku}: no category ${slug}`);
    return id;
  };

  // Parents before children: `upsertBySlug` sets the parent on insert, so a
  // sub-category seeded first would land top-level and stay there — the
  // conflict branch never re-parents, which is what keeps a re-seed from
  // undoing an admin's move.
  for (const category of SEED_CATEGORIES) {
    const row = await CategoryDao.upsertBySlug(category);
    categoryIdBySlug.set(row.slug, row.id);
  }
  for (const { parentSlug, ...sub } of SEED_SUBCATEGORIES) {
    const row = await CategoryDao.upsertBySlug({
      ...sub,
      parentId: idFor(parentSlug, sub.slug),
    });
    categoryIdBySlug.set(row.slug, row.id);
  }

  for (const {
    categorySlug,
    extraCategorySlugs = [],
    imageKeys,
    ...product
  } of SEED_PRODUCTS) {
    // Passed on every run, empty list and all: `upsertBySku` replaces a
    // product's additional categories wholesale, so leaving the key off would
    // clear them on the next re-seed.
    const row = await ProductDao.upsertBySku({
      ...product,
      categoryId: idFor(categorySlug, product.sku),
      extraCategoryIds: extraCategorySlugs.map((slug) =>
        idFor(slug, product.sku),
      ),
    });
    await ProductDao.setImages(row.id, imageKeys);
  }

  return {
    categories: SEED_CATEGORIES.length + SEED_SUBCATEGORIES.length,
    products: SEED_PRODUCTS.length,
  };
};
