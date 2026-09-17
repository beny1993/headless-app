// No database needed: these check the seed data itself, so they run everywhere.
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SEED_CATEGORIES, SEED_PRODUCTS } from '@/db/seed/catalog-data';

describe('catalog seed data', () => {
  it('carries the eight demo products of the design prototype', () => {
    expect(SEED_PRODUCTS).toHaveLength(8);
    expect(SEED_CATEGORIES).toHaveLength(6);
  });

  it('has a unique slug and sku for every product', () => {
    expect(new Set(SEED_PRODUCTS.map((p) => p.sku)).size).toBe(
      SEED_PRODUCTS.length,
    );
    expect(new Set(SEED_PRODUCTS.map((p) => p.slug)).size).toBe(
      SEED_PRODUCTS.length,
    );
    expect(new Set(SEED_CATEGORIES.map((c) => c.slug)).size).toBe(
      SEED_CATEGORIES.length,
    );
  });

  it('points every category slug at a category that exists', () => {
    const known = new Set<string>(SEED_CATEGORIES.map((c) => c.slug));

    for (const product of SEED_PRODUCTS) {
      expect(known).toContain(product.categorySlug);
    }
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
    for (const slug of [
      ...SEED_PRODUCTS.map((p) => p.slug),
      ...SEED_CATEGORIES.map((c) => c.slug),
    ]) {
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
