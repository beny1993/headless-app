// Shape tests for the catalog tables. These need no database, so they run on
// every `pnpm test` — including on a machine with no Docker, where the DAO
// integration suites skip themselves.
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  categories,
  PET_TYPES,
  PET_TYPE_VALUES,
  petTypeEnum,
  productCategories,
  productImages,
  products,
} from '@/db/schema/catalog';

const checkNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).checks.map((c) => c.name);

/**
 * Every foreign key as `name -> onDelete`, sorted.
 *
 * Named pairs rather than a bare list of modes: an array of `['restrict',
 * 'restrict']` says nothing about *which* key is which, and depends on the
 * order the columns happen to be declared in — so moving a column past another
 * rewrites the expectation without changing the schema.
 */
const foreignKeyRules = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table)
    .foreignKeys.map((fk) => `${fk.getName()} -> ${fk.onDelete}`)
    .sort();

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

  it('holds one or both pet types, from the cat/dog enum', () => {
    // An array of the enum, not a third `both` value: the same enum types a
    // customer's pet, and a pet is one species.
    expect(products.petTypes.getSQLType()).toBe('pet_type[]');
    // Read off the constant the column is built from, so a third pet type
    // added there does not need this line edited to stay true.
    expect(petTypeEnum.enumValues).toEqual([...PET_TYPE_VALUES]);
    expect(products.petTypes.notNull).toBe(true);
    expect(Object.values(PET_TYPES)).toEqual(['cat', 'dog']);
    // An empty array is still «no pet» — the CHECK is what refuses it.
    expect(checkNames(products)).toContain('products_pet_type_not_empty');
  });

  it('cascades images with their product but restricts category deletes', () => {
    expect(foreignKeyRules(productImages)).toEqual([
      'product_images_product_id_products_id_fk -> cascade',
    ]);

    // Neither a category with products nor a head with members may silently
    // take them down with it — both of the table's keys restrict, and the
    // expectation names which is which.
    expect(foreignKeyRules(products)).toEqual([
      'products_category_id_categories_id_fk -> restrict',
      'products_variant_of_products_id_fk -> restrict',
    ]);
  });

  it('files a product under extra categories without loosening either end', () => {
    // The junction and the self-FK are what this story adds, and the sweep
    // above hand-listed three tables and read neither. Flip the junction's
    // category key to `cascade` and deleting a category would take every
    // product filed under it out of its *other* categories as well; flip
    // `categories.parent_id` and deleting a parent would silently take its
    // sub-categories. Both stay green on a machine with no Docker, which is
    // the gap this file exists to close.
    expect(foreignKeyRules(productCategories)).toEqual([
      'product_categories_category_id_categories_id_fk -> restrict',
      'product_categories_product_id_products_id_fk -> cascade',
    ]);
    expect(foreignKeyRules(categories)).toEqual([
      'categories_parent_id_categories_id_fk -> restrict',
    ]);
  });

  it('keeps a product family one level deep and its label present', () => {
    const names = checkNames(products);
    // The half of «one level» a single row can see; `ProductDao` owns the rest.
    expect(names).toContain('products_variant_not_self');
    // A member with a blank label renders an empty chip and a bare dash on an
    // order line, so the database refuses it rather than the form alone.
    expect(names).toContain('products_variant_label_present');
  });
});
