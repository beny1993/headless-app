// No database needed: these check the seed data itself, so they run everywhere.
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_PRODUCT_IMAGES } from '@/lib/catalog/product-input';
import { imageKeySchema } from '@/lib/storage/image-upload';
import {
  SEED_CATEGORIES,
  SEED_PRODUCTS,
  SEED_SUBCATEGORIES,
} from '@/db/seed/catalog-data';
import { LOW_STOCK_THRESHOLD } from '@/features/storefront/product/availability';
import { normalizePetTypes } from '@/lib/catalog/product-query';

/** Main and sub-categories alike — what a product may be filed under. */
const known = new Set<string>([
  ...SEED_CATEGORIES.map((c) => c.slug),
  ...SEED_SUBCATEGORIES.map((c) => c.slug),
]);

describe('catalog seed data', () => {
  it('carries demo products, categories and sub-categories at all', () => {
    // Counts, deliberately not: nothing depends on how many there are —
    // `catalog.integration.test.ts` derives everything from `SEED_PRODUCTS.length`
    // and the category coupling is pinned in `home/content.test.ts` — so an
    // exact number is a change detector that every future seed edit has to pay.
    expect(SEED_PRODUCTS.length).toBeGreaterThan(0);
    expect(SEED_CATEGORIES.length).toBeGreaterThan(0);
    expect(SEED_SUBCATEGORIES.length).toBeGreaterThan(0);
  });

  it('has a unique slug and sku for every product', () => {
    expect(new Set(SEED_PRODUCTS.map((p) => p.sku)).size).toBe(
      SEED_PRODUCTS.length,
    );
    expect(new Set(SEED_PRODUCTS.map((p) => p.slug)).size).toBe(
      SEED_PRODUCTS.length,
    );
    // Unique across both exports: the database's unique index covers the one
    // `categories` table, so a sub-category may not reuse a parent's slug.
    expect(known.size).toBe(SEED_CATEGORIES.length + SEED_SUBCATEGORIES.length);
  });

  it('hangs every sub-category off a top-level category', () => {
    // One level only, so a sub-category's parent is never another sub.
    const topLevel = new Set<string>(SEED_CATEGORIES.map((c) => c.slug));

    for (const sub of SEED_SUBCATEGORIES) {
      expect(topLevel).toContain(sub.parentSlug);
    }
  });

  it('points every category slug at a category that exists', () => {
    for (const product of SEED_PRODUCTS) {
      expect(known).toContain(product.categorySlug);
    }
  });

  it('gives every additional category a home of its own', () => {
    // The DAO strips a repeated or main-equal id on write; seeding one anyway
    // would make the demo catalog quietly disagree with what it stores.
    for (const product of SEED_PRODUCTS) {
      const extras = product.extraCategorySlugs ?? [];
      expect(new Set(extras).size).toBe(extras.length);
      for (const slug of extras) {
        expect(known).toContain(slug);
        expect(slug).not.toBe(product.categorySlug);
      }
    }
    // The malt paste of the story: one product really does use this.
    expect(
      SEED_PRODUCTS.some((p) => (p.extraCategorySlugs ?? []).length > 0),
    ).toBe(true);
  });

  it('stores every pet selection non-empty and in canonical order', () => {
    // What the database's CHECK and the shared schema's transform enforce —
    // caught here before a re-seed hits either.
    for (const product of SEED_PRODUCTS) {
      expect(product.petTypes.length).toBeGreaterThan(0);
      expect(normalizePetTypes(product.petTypes)).toEqual(product.petTypes);
    }
    expect(SEED_PRODUCTS.some((p) => p.petTypes.length === 2)).toBe(true);
  });

  it('keeps the stock the E2E fixtures pick on, appended rows and all', () => {
    // e2e/support.ts reduces this list to the best-stocked product and finds
    // the sold-out and the low-stock one. An appended row that out-stocked the
    // first, or added a second sold-out one, would move three specs onto a
    // different product without changing a line of them.
    const best = SEED_PRODUCTS.reduce((a, b) => (b.stock > a.stock ? b : a));

    expect(best.sku).toBe('AP-CAT-TREAT-60');
    expect(SEED_PRODUCTS.filter((p) => p.stock === 0)).toHaveLength(1);
    expect(
      SEED_PRODUCTS.filter(
        (p) => p.stock > 1 && p.stock <= LOW_STOCK_THRESHOLD,
      ),
    ).toHaveLength(1);
  });

  it('prices everything in whole Toman above zero', () => {
    // No floats, no decimals, no free products — the same rules the CHECK
    // constraints enforce, caught here before anything touches a database.
    for (const product of SEED_PRODUCTS) {
      expect(Number.isSafeInteger(product.price)).toBe(true);
      expect(product.price).toBeGreaterThan(0);
      expect(product.stock).toBeGreaterThanOrEqual(0);
      if (product.oldPrice !== null) {
        expect(Number.isSafeInteger(product.oldPrice)).toBe(true);
        expect(product.oldPrice).toBeGreaterThan(product.price);
      }
    }
  });

  it('uses Latin slugs the design’s admin form would accept', () => {
    // `/^[a-z0-9-]{3,}$/` — see AdminProductForm in design/src/app/App.tsx.
    for (const slug of [...SEED_PRODUCTS.map((p) => p.slug), ...known]) {
      expect(slug).toMatch(/^[a-z0-9-]{3,}$/);
    }
  });

  it('keeps the Persian titles the design wrote, ZWNJ intact', () => {
    // U+200C inside «اسباب‌بازی». Normalizing it away here would quietly
    // change what the storefront renders and what the search story indexes.
    expect(SEED_CATEGORIES.map((c) => c.title)).toContain('اسباب‌بازی');
    expect(SEED_PRODUCTS[7].title).toBe('اسباب‌بازی تعاملی پر و زنگوله');
    expect(SEED_PRODUCTS[7].title).toContain('\u200C');
  });

  it('seeds one product with a gallery, so the strip is reachable without building one', () => {
    // Every other product carries a single photo and renders no strip at all.
    // This one is what lets a spec walk the gallery at both widths, needing no
    // admin session to exist — and `e2e/support.ts` throws at import without
    // it, so the guard has to run where there is no database either.
    const withGallery = SEED_PRODUCTS.filter(
      (product) => product.imageKeys.length > 1,
    );

    // Exactly one, not «at least one»: `e2e/admin-catalog.spec.ts` states that
    // the only galleries in the suite are its own product and this one, and
    // relaxing this left that sentence with nothing holding it up.
    expect(withGallery).toHaveLength(1);
    // Three, not two: with two photos the only clickable thumbnail is the
    // adjacent one, and a one-slide jump is the single case that cannot catch
    // `scroll-snap-stop: always` refusing to pass a snap point.
    expect(withGallery[0].imageKeys.length).toBeGreaterThanOrEqual(3);
    // Distinct files, so a spec can tell which photo is on screen.
    expect(new Set(withGallery[0].imageKeys).size).toBe(
      withGallery[0].imageKeys.length,
    );
  });

  it('keeps every product within the gallery ceiling', () => {
    // `setImages` enforces no cap — the seed reaches it without passing zod —
    // so a seeded row with six photos would make the admin form unable to save
    // that product at all: it always sends the whole list, and the API refuses
    // anything above the ceiling.
    for (const product of SEED_PRODUCTS) {
      expect(product.imageKeys.length).toBeLessThanOrEqual(MAX_PRODUCT_IMAGES);
      expect(new Set(product.imageKeys).size).toBe(product.imageKeys.length);
      // Shape as well as count. The gallery PUT refuses anything outside
      // `imageKeySchema` while the seed writes through `setImages` without
      // passing zod — so a key like `products/cat_dry_food.jpg` would store
      // fine and then make that product's gallery unsaveable from the admin
      // form, which always sends the whole list.
      for (const key of product.imageKeys) {
        expect(imageKeySchema.safeParse(key).success, key).toBe(true);
      }
    }
  });

  it('bundles every referenced image locally — no external hotlinks', async () => {
    // The object key is a storage key; today it resolves to a committed file
    // under public/. A typo here would only surface as a broken image in the
    // browser, so check the files really exist.
    const keys = [...new Set(SEED_PRODUCTS.flatMap((p) => p.imageKeys))];
    expect(keys).not.toHaveLength(0);

    for (const key of keys) {
      expect(key).not.toMatch(/^https?:/);
      await expect(
        access(join(process.cwd(), 'public', key)),
      ).resolves.toBeUndefined();
    }
  });

  it('gives every top-level category a committed photo for its home tile', async () => {
    // The home strip draws each tile from `categories.image_key`, so a demo
    // category without a key is a plain tile in every fresh checkout — and a
    // typo would only surface as a broken image in the browser.
    for (const { slug, imageKey } of SEED_CATEGORIES) {
      expect(imageKeySchema.safeParse(imageKey).success, slug).toBe(true);
      await expect(
        access(join(process.cwd(), 'public', imageKey)),
      ).resolves.toBeUndefined();
    }
  });

  it('includes the zero-stock and low-stock products the design needs', () => {
    // The prototype has an "out of stock" panel and a "only N left" warning;
    // without these two rows neither state is reachable in development.
    expect(SEED_PRODUCTS.map((p) => p.stock)).toContain(0);
    expect(SEED_PRODUCTS.some((p) => p.stock > 0 && p.stock <= 5)).toBe(true);
  });

  it('covers both pet types and offers at least one discounted product', () => {
    expect(new Set(SEED_PRODUCTS.flatMap((p) => p.petTypes))).toEqual(
      new Set(['cat', 'dog']),
    );
    expect(SEED_PRODUCTS.some((p) => p.oldPrice !== null)).toBe(true);
  });
});

describe('the seeded product family', () => {
  const members = SEED_PRODUCTS.filter((product) => product.variantOfSku);

  it('seeds one family, so the storefront and the E2E suite have one', () => {
    expect(members.length).toBeGreaterThan(0);
    const heads = new Set(members.map((member) => member.variantOfSku));
    expect(heads.size).toBe(1);
  });

  it('lists every head before the members that point at it', () => {
    // The runner resolves `variantOfSku` against ids it has already written, so
    // a member placed above its head throws rather than seeding a broken family.
    for (const member of members) {
      const headIndex = SEED_PRODUCTS.findIndex(
        (product) => product.sku === member.variantOfSku,
      );
      const memberIndex = SEED_PRODUCTS.indexOf(member);
      expect(headIndex).toBeGreaterThanOrEqual(0);
      expect(headIndex).toBeLessThan(memberIndex);
    }
  });

  it('gives every member and every head a label', () => {
    const heads = new Set(members.map((member) => member.variantOfSku));
    for (const product of SEED_PRODUCTS) {
      const isFamily = product.variantOfSku || heads.has(product.sku);
      if (isFamily) expect(product.variantLabel?.trim()).toBeTruthy();
    }
  });

  it('prices the family unevenly, so a card exercises «از …»', () => {
    const heads = new Set(members.map((member) => member.variantOfSku));
    const family = SEED_PRODUCTS.filter(
      (product) => product.variantOfSku || heads.has(product.sku),
    );
    const prices = new Set(family.map((product) => product.price));
    expect(prices.size).toBeGreaterThan(1);
  });

  it('files every member where its head is', () => {
    // No longer a change detector on data nobody reads: a family is filed
    // once, on its head, and `ProductDao` copies the head's category and pets
    // onto a member on every write. `upsertBySku` is the one writer that does
    // not — the seed inserts the whole catalogue in one pass — so the seed
    // data has to hold the invariant itself or a re-seed would quietly break
    // it.
    const bySku = new Map(SEED_PRODUCTS.map((p) => [p.sku, p]));
    for (const member of members) {
      const head = bySku.get(member.variantOfSku!);
      expect(member.categorySlug).toBe(head?.categorySlug);
      expect(member.petTypes).toEqual(head?.petTypes);
      expect(member.extraCategorySlugs ?? []).toEqual(
        head?.extraCategorySlugs ?? [],
      );
    }
  });
});
