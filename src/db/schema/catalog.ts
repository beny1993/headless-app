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
  type AnyPgColumn,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from '@/db/schema/columns';
import {
  PET_TYPES,
  PET_TYPE_VALUES,
  type PetType,
} from '@/lib/catalog/product-query';

// The `pet_type` domain is defined in `@/lib/catalog/product-query`, not here:
// the storefront's URL parser is a client module and cannot import this file
// (it would put drizzle in the browser bundle), so the values live where both
// sides can reach them and this column is built from them. Re-exported so every
// existing importer of the schema keeps working — one definition, one alias.
export { PET_TYPES, PET_TYPE_VALUES, type PetType };

// Built from the array, like `order_status`, `payment_method`, `payment_status`,
// `discount_type` and `pet_gender`: the database's domain and the client's are
// one definition. Hand-listed, a third pet type would pass every zod schema and
// `normalizePetTypes` while drizzle generated no `ALTER TYPE … ADD VALUE`, and
// each write of it would fail at the driver.
export const petTypeEnum = pgEnum('pet_type', PET_TYPE_VALUES);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Persian display title, stored exactly as entered — no normalization. */
    title: text('title').notNull(),
    /** Latin URL segment; the design's admin form enforces `[a-z0-9-]{3,}`. */
    slug: text('slug').notNull().unique(),
    /** Manual ordering for the storefront's category strip. */
    sortOrder: integer('sort_order').default(0).notNull(),
    /**
     * The category this one sits under, or `null` for a top-level one. Exactly
     * one level deep: a row whose parent already has a parent is refused by
     * `CategoryDao`, which is the only place that rule can live — a CHECK sees
     * one row and cannot look at another. `restrict` so a parent with children
     * cannot be deleted out from under them.
     */
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, {
      onDelete: 'restrict',
    }),
    /**
     * The photo on the category's home-page tile: a storage key, the same shape
     * as `product_images.object_key` (never a URL), or `null` for none. A
     * replaced photo's file is not deleted — see `categoryInputSchema`.
     */
    imageKey: text('image_key'),
    createdAt,
    updatedAt,
  },
  (table) => [
    // The one part of the rule the database *can* enforce on its own.
    check('categories_parent_not_self', sql`${table.parentId} <> ${table.id}`),
    index('categories_parent_id_idx').on(table.parentId),
  ],
);

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
    /**
     * Soft delete. A product that is ordered or has members only ever goes
     * this way; one nothing references is deleted outright instead
     * (`ProductDao.hardDelete`, decided by `src/logic/admin/product-removal.ts`).
     */
    isActive: boolean('is_active').default(true).notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    /**
     * Which pets the product suits — one of them, or both. An array of the
     * `pet_type` enum rather than a third `both` value, because the very same
     * enum types a customer's own pet (`pets.type`) and a pet is one species.
     * Stored in `PET_TYPE_VALUES` order; `products_pet_type_not_empty` is what
     * keeps «no pet at all» out.
     */
    petTypes: petTypeEnum('pet_type').array().notNull(),
    /**
     * The product this one is a variant of — a smell, a colour, a size — or
     * `null`. A **head** is null here and carries its own `variantLabel`, which
     * is what makes the storefront listing one predicate (`variant_of is null`)
     * rather than a grouping with a count to get wrong.
     *
     * Exactly one level, like `categories.parent_id`, and enforced in the same
     * place for the same reason: a CHECK sees one row and cannot look at the
     * head's own `variant_of`. `restrict` so a head cannot be deleted out from
     * under its members.
     */
    variantOf: uuid('variant_of').references((): AnyPgColumn => products.id, {
      onDelete: 'restrict',
    }),
    /** «۱۰ کیلوگرم», «قرمز». Set on a member and on its head; null alone. */
    variantLabel: text('variant_label'),
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
    // A product with no pet at all is filed nowhere and listed under neither
    // filter. NOT NULL alone would let `{}` through.
    check(
      'products_pet_type_not_empty',
      sql`cardinality(${table.petTypes}) >= 1`,
    ),
    // The one half of «one level deep» the database can enforce by itself.
    check('products_variant_not_self', sql`${table.variantOf} <> ${table.id}`),
    // A member with no label renders an empty chip and an order line ending in
    // a bare dash. Presence only — a CHECK is false, never NULL, so this one
    // cannot be satisfied by the missing value it exists to refuse (the shape
    // `variant_label is not null` has, and `length(btrim(null)) > 0` does not).
    check(
      'products_variant_label_present',
      sql`${table.variantOf} is null or ${table.variantLabel} is not null`,
    ),
    // …and a label that is *set* carries something a shopper can read. ZWNJ is
    // the gap every other guard leaves open: Persian words need it, so it is
    // deliberately allowed by `FORBIDDEN_TEXT_CHARS`, and neither `trim()` nor
    // `btrim` removes it — a label of nothing but ZWNJ passed all three and
    // rendered as a chip with no text on it. Stripped here by code point
    // (`chr(8204)`, constructed — never a typed invisible byte), then every
    // space class, leaving the question «is anything left».
    check(
      'products_variant_label_visible',
      sql`${table.variantLabel} is null or regexp_replace(replace(${table.variantLabel}, chr(8204), ''), '[[:space:]]', '', 'g') <> ''`,
    ),
    index('products_category_id_idx').on(table.categoryId),
    // Read by the family scalars on every storefront card, and by the guard
    // that refuses to soft-delete a head that still has members.
    index('products_variant_of_idx').on(table.variantOf),
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

/**
 * The **additional** categories a product is filed under — never its primary
 * one, which stays `products.category_id`. Keeping the primary out of here is
 * what makes a bug in this table unable to hide a product from the category it
 * mainly belongs to, and what lets «a product always has a category» stay a
 * database guarantee instead of a zod rule.
 *
 * The composite primary key refuses the same category twice for free. «An extra
 * is never the primary» cannot be a CHECK — it spans two tables — so `ProductDao`
 * strips it on every write; a stray one is harmless to the filter and the count.
 *
 * The product foreign key cascades like `product_images`: the admin's hard
 * delete of a product nothing references takes these rows with it. The category
 * one restricts, which is what keeps a category in use undeletable.
 */
export const productCategories = pgTable(
  'product_categories',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    /** Position in the admin's own list — index on write, `asc` on read. */
    sortOrder: integer('sort_order').default(0).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.categoryId] }),
    index('product_categories_category_id_idx').on(table.categoryId),
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
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductImage = typeof productImages.$inferSelect;

/**
 * A product with its images and its additional categories attached, as the
 * storefront reads it. `categoryId` is still the primary category; these are
 * the others, in the order the admin added them.
 */
export type ProductWithImages = Product & {
  images: ProductImage[];
  extraCategoryIds: string[];
};

/**
 * One chip on the product page: a member of this product's family, including
 * the product being viewed. Head first, then the members in the order they were
 * created. Empty for a standalone product, which is what makes «show no chips»
 * the absence of data rather than a flag.
 */
export type VariantChip = {
  id: string;
  slug: string;
  label: string;
  isCurrent: boolean;
  /**
   * Integer Toman. The card advertises the family's cheapest buyable member, so the
   * page it links to has to say which member that is — otherwise «از ۱۴۹٬۰۰۰»
   * lands on a heading priced ۱۸۵٬۰۰۰ with nothing explaining the gap.
   */
  price: number;
  /** A chip for a sold-out size must say so before it is clicked. */
  inStock: boolean;
};

/**
 * A product as the storefront *listing* reads it. The family scalars are
 * computed per row by the listing query, never by a join — a join against the
 * members would duplicate the row and break `total`.
 *
 * For a standalone product `familyMinPrice` is its own price, `familyPricesVary`
 * is false and `familyInStock` is `stock > 0`, so a caller that knows nothing
 * about families still reads the truth.
 */
export type ProductCard = ProductWithImages & {
  /**
   * Integer Toman: the cheapest member a shopper can buy — or, when nothing is
   * in stock, the cheapest active member.
   */
  familyMinPrice: number;
  /** `min <> max` across those same members — what makes the card read «از …». */
  familyPricesVary: boolean;
  /** True when any active member has stock; a sold-out head must not hide one. */
  familyInStock: boolean;
  /**
   * True when this row has active members. Distinct from `familyPricesVary`:
   * a family whose sizes happen to cost the same still must not be added to the
   * cart from the shop grid, or the shopper gets a smell nobody chose.
   */
  familyHasMembers: boolean;
  /**
   * The slug the card opens: the head while it has stock, else the cheapest
   * member in stock, else the head. A standalone product opens itself.
   */
  familyOpenSlug: string;
};

/** A product as its own page reads it: the row plus its family's chips. */
export type ProductDetail = ProductWithImages & {
  variants: VariantChip[];
};
