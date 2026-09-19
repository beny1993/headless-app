// No database needed: these check the seed data itself, so they run everywhere.
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
    expect(SEED_PRODUCTS[7].title).toContain('‌');
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
});
