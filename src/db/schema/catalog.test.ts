// Shape tests for the catalog tables. These need no database, so they run on
// every `pnpm test` — including on a machine with no Docker, where the DAO
// integration suites skip themselves.
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  categories,
  PET_TYPES,
  productImages,
  products,
} from '@/db/schema/catalog';

const checkNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).checks.map((c) => c.name);

describe('catalog schema', () => {
  it('stores every timestamp with a timezone', () => {
    // Same guard as the auth tables: a bare `timestamp()` drops the offset, so
    // a product created at 20:00 UTC and one at 20:00 +03:30 collapse into the
    // same instant once the storefront renders Jalali dates.
    const timestamps = [categories, products, productImages]
      .flatMap((table) => Object.values(getTableColumns(table)))
      .filter((column) => column.columnType === 'PgTimestamp');

    expect(timestamps).not.toHaveLength(0);
    for (const column of timestamps) {
      expect(`${column.name}: ${column.getSQLType()}`).toBe(
        `${column.name}: timestamp with time zone`,
      );
    }
  });

  it('keeps money in bigint, never a float or a numeric', () => {
    // Toman is an integer currency. `real`/`numeric` would let a rounding error
    // into an order total, and `integer` overflows at ~2.1 billion Toman.
    for (const column of [products.price, products.oldPrice]) {
      expect(`${column.name}: ${column.getSQLType()}`).toBe(
        `${column.name}: bigint`,
      );
    }
  });

  it('leaves old_price nullable and price required', () => {
    expect(products.price.notNull).toBe(true);
    expect(products.oldPrice.notNull).toBe(false);
  });

  it('guards stock, price and old price at the database level', () => {
    // App-side validation is bypassable (psql, a migration, a future admin
    // route); these are the constraints that actually hold.
    expect(checkNames(products)).toEqual(
      expect.arrayContaining([
        'products_stock_non_negative',
        'products_price_positive',
        'products_old_price_above_price',
      ]),
    );
  });

  it('makes both slug and sku unique — order items snapshot the sku', () => {
    expect(products.slug.isUnique).toBe(true);
    expect(products.sku.isUnique).toBe(true);
    expect(categories.slug.isUnique).toBe(true);
  });

  it('defaults products to active so a soft delete is the deliberate act', () => {
    expect(products.isActive.default).toBe(true);
  });

  it('restricts the pet type to cat and dog', () => {
    expect(products.petType.enumValues).toEqual(['cat', 'dog']);
    expect(Object.values(PET_TYPES)).toEqual(['cat', 'dog']);
  });

  it('cascades images with their product but restricts category deletes', () => {
    const imageFks = getTableConfig(productImages).foreignKeys.map(
      (fk) => fk.onDelete,
    );
    expect(imageFks).toEqual(['cascade']);

    // A category with products must not silently take them down with it.
    const productFks = getTableConfig(products).foreignKeys.map(
      (fk) => fk.onDelete,
    );
    expect(productFks).toEqual(['restrict']);
  });
});
