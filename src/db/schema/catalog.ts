// Product catalog: categories, products and their images. Shapes follow the ER
// diagram in the vault's `Design - Orders and Payments Schema` note so the later
// orders story can snapshot title/sku/unit price onto `order_items` unchanged.
//
// Two house rules are load-bearing here:
//   · Money is integer Toman in `bigint` — never a float, never a numeric.
//   · Every timestamp is `timestamptz` (`{ withTimezone: true }`), as in auth.ts.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { PET_TYPES, type PetType } from '@/lib/catalog/product-query';

// The `pet_type` domain is defined in `@/lib/catalog/product-query`, not here:
// the storefront's URL parser is a client module and cannot import this file
// (it would put drizzle in the browser bundle), so the values live where both
// sides can reach them and this column is built from them. Re-exported so every
// existing importer of the schema keeps working — one definition, one alias.
export { PET_TYPES, type PetType };

export const petTypeEnum = pgEnum('pet_type', [PET_TYPES.CAT, PET_TYPES.DOG]);

const createdAt = timestamp('created_at', { withTimezone: true })
  .defaultNow()
  .notNull();

const updatedAt = timestamp('updated_at', { withTimezone: true })
  .defaultNow()
  .$onUpdate(() => /* @__PURE__ */ new Date())
  .notNull();

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Persian display title, stored exactly as entered — no normalization. */
  title: text('title').notNull(),
  /** Latin URL segment; the design's admin form enforces `[a-z0-9-]{3,}`. */
  slug: text('slug').notNull().unique(),
  /** Manual ordering for the storefront's category strip. */
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt,
  updatedAt,
});

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    slug: text('slug').notNull().unique(),
    /** Snapshotted onto `order_items`; unique so that snapshot is traceable. */
    sku: text('sku').notNull().unique(),
    brand: text('brand'),
    description: text('description'),
    /** One-line selling point under the title on the product card. */
    benefit: text('benefit'),
    /**
     * The search index's copy of this product: `title`, `brand` and `benefit`
     * run through `normalizeSearchText` and joined with spaces. Never displayed,
     * never edited — `ProductDao` is its only writer and recomputes it on every
     * write, which is what «normalize on write» means here.
     *
     * `description` is deliberately left out. It is prose, and trigram
     * similarity is measured against the whole stored string, so paragraphs of
     * it would bury the words a shopper actually types.
     *
     * Defaults to empty rather than being nullable: a product always has a
     * searchable text, even if it is nothing, and `''` simply matches no term.
     */
    searchText: text('search_text').default('').notNull(),
    /** Integer Toman. */
    price: bigint('price', { mode: 'number' }).notNull(),
    /** Integer Toman; set only to show a struck-through "was" price. */
    oldPrice: bigint('old_price', { mode: 'number' }),
    stock: integer('stock').default(0).notNull(),
    /** Soft delete. There is no hard-delete path anywhere in the DAO. */
    isActive: boolean('is_active').default(true).notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    petType: petTypeEnum('pet_type').notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    // Oversell prevention leans on this: the atomic `UPDATE … WHERE stock >= qty`
    // that the orders story uses is only safe if the column can never go below
    // zero by another route.
    check('products_stock_non_negative', sql`${table.stock} >= 0`),
    // Money integrity at the last trust boundary. The design's admin form
    // rejects both of these too, but psql and migrations bypass that.
    check('products_price_positive', sql`${table.price} > 0`),
    check(
      'products_old_price_above_price',
      sql`${table.oldPrice} is null or ${table.oldPrice} > ${table.price}`,
    ),
    index('products_category_id_idx').on(table.categoryId),
    index('products_is_active_idx').on(table.isActive),
    // Trigram index over the normalized text. GIN rather than GiST: the
    // storefront only asks «does this row match», never «how close is it», and
    // GiST's distance ordering is the one thing GIN cannot do. It is a real
    // index, not decoration — `search_text %> :term` plans as a bitmap index
    // scan on it. `pg_trgm` and this operator class are created by the same
    // migration that adds the column.
    index('products_search_text_trgm_idx').using(
      'gin',
      sql`${table.searchText} gin_trgm_ops`,
    ),
  ],
);

export const productImages = pgTable(
  'product_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /**
     * Storage key, not a URL. Today the dev stand-in is a file under `public/`
     * (`products/cat-dry-food.jpg` → `/products/cat-dry-food.jpg`); the admin
     * story puts an S3-compatible driver behind the same plain string.
     */
    objectKey: text('object_key').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt,
  },
  (table) => [index('product_images_product_id_idx').on(table.productId)],
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductImage = typeof productImages.$inferSelect;
export type NewProductImage = typeof productImages.$inferInsert;

/** A product with its images attached, as the storefront reads it. */
export type ProductWithImages = Product & { images: ProductImage[] };
