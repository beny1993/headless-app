// Writes the demo catalog (./catalog-data.ts) through the DAOs. Run it with
// `pnpm seed-catalog`.
//
// Re-running is safe: categories upsert by slug, products by sku, and a
// product's images are replaced rather than appended. A seeded product an
// admin deactivated stays inactive (see `ProductDao.upsertBySku`); one an
// admin deleted outright comes back, since the upsert finds no row to keep.
import { CategoryDao } from '@/db/dao/CategoryDao';
import { ProductDao } from '@/db/dao/ProductDao';
import {
  SEED_CATEGORIES,
  SEED_PRODUCTS,
  SEED_SUBCATEGORIES,
} from '@/db/seed/catalog-data';

/** `map.get(key)`, or throw `message` — a seed that points at nothing is a bug. */
const must = <V>(map: Map<string, V>, key: string, message: string): V => {
  const value = map.get(key);
  if (value === undefined) throw new Error(message);
  return value;
};

export const seedCatalog = async (): Promise<{
  categories: number;
  products: number;
}> => {
  const categoryIdBySlug = new Map<string, string>();
  const idFor = (slug: string, sku: string) =>
    must(categoryIdBySlug, slug, `Seed product ${sku}: no category ${slug}`);

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

  // A family's head has to exist before its members can point at it, so the
  // runner keeps the ids it has written and `SEED_PRODUCTS` lists heads first.
  const productIdBySku = new Map<string, string>();
  const headIdFor = (headSku: string, sku: string) =>
    must(
      productIdBySku,
      headSku,
      `Seed product ${sku}: head ${headSku} not seeded yet — list it first`,
    );

  for (const {
    categorySlug,
    extraCategorySlugs = [],
    imageKeys,
    variantOfSku,
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
      variantOf: variantOfSku ? headIdFor(variantOfSku, product.sku) : null,
    });
    productIdBySku.set(row.sku, row.id);
    await ProductDao.setImages(row.id, imageKeys);
  }

  return {
    categories: SEED_CATEGORIES.length + SEED_SUBCATEGORIES.length,
    products: SEED_PRODUCTS.length,
  };
};
