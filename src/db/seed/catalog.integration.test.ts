// Needs a live database — see src/db/test-db.ts. The seed data itself is
// checked without one in ./catalog-data.test.ts.
import { inArray } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  productCategories,
  productImages,
  products,
} from '@/db/schema/catalog';
import { SEED_PRODUCTS, SEED_SUBCATEGORIES } from '@/db/seed/catalog-data';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';

const { CategoryDao } = await importWithDb(
  () => import('@/db/dao/CategoryDao'),
);
const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));
const { seedCatalog } = await importWithDb(() => import('@/db/seed/catalog'));

const skus = SEED_PRODUCTS.map((product) => product.sku);

// Picked by what makes each one interesting, never by index: appending a row
// to the seed must not be able to point these at a different product.
const bothPets = SEED_PRODUCTS.find((product) => product.petTypes.length === 2);
const multiCategory = SEED_PRODUCTS.find(
  (product) => (product.extraCategorySlugs ?? []).length > 0,
);
if (!bothPets || !multiCategory) {
  throw new Error('The catalog seed needs a both-pets and a two-category row.');
}

/** The seeded family: the members that name a head, and the head they name. */
const members = SEED_PRODUCTS.filter((product) => product.variantOfSku);
const familyHead = SEED_PRODUCTS.find((product) =>
  members.some((member) => member.variantOfSku === product.sku),
);
if (!familyHead || members.length === 0) {
  throw new Error('The catalog seed needs one product family.');
}

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
    const categoriesBefore = await CategoryDao.list();
    const junctionBefore = await testDb.select().from(productCategories);

    await seedCatalog();

    const after = await seededProducts();
    const imagesAfter = await seededImages();

    expect(after).toHaveLength(before.length);
    expect(imagesAfter).toHaveLength(imagesBefore.length);
    // Categories upsert by slug and the extras are replaced wholesale, so a
    // re-run must neither add a second «مالت» nor stack junction rows.
    expect(await CategoryDao.list()).toHaveLength(categoriesBefore.length);
    expect(await testDb.select().from(productCategories)).toHaveLength(
      junctionBefore.length,
    );
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

  it('gives every seeded product its photos, in the order the data lists them', async () => {
    const listed = (await ProductDao.listForAdmin()).filter((row) =>
      skus.includes(row.sku),
    );

    expect(listed).toHaveLength(SEED_PRODUCTS.length);
    for (const product of listed) {
      const seeded = SEED_PRODUCTS.find((row) => row.sku === product.sku);
      expect(product.images.map((image) => image.objectKey)).toEqual(
        seeded?.imageKeys,
      );
    }
  });

  it('seeds one product with a gallery, so the strip is reachable without building one', async () => {
    // Every other product has a single photo and renders no strip at all. This
    // one is what lets a spec walk the gallery — at both widths, since it needs
    // no admin session to exist.
    const withGallery = SEED_PRODUCTS.filter(
      (product) => product.imageKeys.length > 1,
    );

    expect(withGallery).toHaveLength(1);
    expect(withGallery[0].imageKeys.length).toBeGreaterThanOrEqual(3);
    // Three distinct files: a gallery whose photos repeat cannot tell a test
    // which one is on screen.
    expect(new Set(withGallery[0].imageKeys).size).toBe(
      withGallery[0].imageKeys.length,
    );
  });

  it('seeds the out-of-stock and low-stock products the design needs', async () => {
    const wet = await ProductDao.getBySlug('sheba-cat-salmon-tuna-wet-food');
    const toy = await ProductDao.getBySlug(
      'smartykat-interactive-feather-bell-toy',
    );

    expect(wet?.stock).toBe(0);
    expect(toy?.stock).toBe(3);
  });

  it('hangs every sub-category under the parent it names', async () => {
    const bySlug = new Map(
      (await CategoryDao.list()).map((row) => [row.slug, row]),
    );

    for (const sub of SEED_SUBCATEGORIES) {
      expect(bySlug.get(sub.slug)?.parentId).toBe(
        bySlug.get(sub.parentSlug)?.id,
      );
    }
  });

  it('hangs every member off the head its sku names', async () => {
    // The seed's whole family mechanism had no database-level test: replacing
    // the `variantOf` lookup with `null` left `vitest run src/db/seed/` green,
    // and the first thing to notice was `pnpm test:e2e`, as «expected 2 chips,
    // got 0». The chips are the feature; this is where they come from.
    const bySku = new Map(
      (await seededProducts()).map((row) => [row.sku, row]),
    );
    const head = bySku.get(familyHead.sku);

    expect(head?.variantOf).toBeNull();
    expect(head?.variantLabel).toBe(familyHead.variantLabel);
    for (const member of members) {
      expect(bySku.get(member.sku)?.variantOf).toBe(head?.id);
      expect(bySku.get(member.sku)?.variantLabel).toBe(member.variantLabel);
    }
  });

  it('keeps the family intact on a second run', async () => {
    // `upsertBySku`'s conflict set has to carry both columns: it rewrites
    // `search_text` from the label, so leaving them out let the two disagree
    // and no re-run could ever put a broken family right.
    await seedCatalog();

    const bySku = new Map(
      (await seededProducts()).map((row) => [row.sku, row]),
    );
    const head = bySku.get(familyHead.sku);
    for (const member of members) {
      expect(bySku.get(member.sku)?.variantOf).toBe(head?.id);
      expect(bySku.get(member.sku)?.variantLabel).toBe(member.variantLabel);
    }
  });

  it('seeds a product for both pets at once', async () => {
    const row = await ProductDao.getBySlug(bothPets.slug);

    expect(row?.petTypes).toEqual(bothPets.petTypes);
  });

  it('seeds a product filed under a second category', async () => {
    const bySlug = new Map(
      (await CategoryDao.list()).map((row) => [row.slug, row]),
    );
    const row = await ProductDao.getBySlug(multiCategory.slug);

    expect(row?.categoryId).toBe(bySlug.get(multiCategory.categorySlug)?.id);
    expect(row?.extraCategoryIds).toEqual(
      (multiCategory.extraCategorySlugs ?? []).map(
        (slug) => bySlug.get(slug)?.id,
      ),
    );
  });

  it('lists the two-category product once under its parent category', async () => {
    // The story's own demo of D2: it is filed under one sub-category and an
    // additional one, both under the same parent, and the parent's filter
    // still counts it once.
    const parentSlug = SEED_SUBCATEGORIES.find(
      (sub) => sub.slug === multiCategory.categorySlug,
    )?.parentSlug;
    const { items, total } = await ProductDao.list({
      categorySlug: parentSlug,
    });

    expect(items.filter((row) => row.sku === multiCategory.sku)).toHaveLength(
      1,
    );
    expect(total).toBe(items.length);
  });

  it('files products under the categories the storefront filters on', async () => {
    const { items: dryFood } = await ProductDao.list({
      categorySlug: 'dry-food',
    });
    const { items: dogs } = await ProductDao.list({
      categorySlug: 'dry-food',
      petType: 'dog',
    });

    // Scoped to the seed's own rows. The assertion is still exact — these two
    // and no other *seeded* product is under dry-food — but it no longer breaks
    // because somebody added a product on the shared dev database, which is
    // what this suite runs against and what an admin is free to do.
    const seeded = (rows: { sku: string }[]) =>
      rows
        .map((row) => row.sku)
        .filter((sku) => SEED_PRODUCTS.some((product) => product.sku === sku))
        .sort();

    expect(seeded(dryFood)).toEqual(
      ['HS-DOG-CHICKEN-2K', 'RC-CAT-ADULT-1K'].sort(),
    );
    expect(seeded(dogs)).toEqual(['HS-DOG-CHICKEN-2K']);
  });
});
