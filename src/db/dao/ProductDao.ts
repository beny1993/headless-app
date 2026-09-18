// All Drizzle DB access goes through DAOs like this one. Multi-DAO operations
// belong in src/logic/, not in route handlers or components. Never write raw SQL.
//
// Products are soft-deleted, never removed: `order_items` snapshots a product's
// title, sku and unit price, and support needs the row behind that snapshot to
// still exist. There is deliberately no hard-delete method here — the storefront
// reads filter on `is_active` instead.
import {
  and,
  arrayContains,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/db';
import {
  DEFAULT_PRODUCT_PAGE_SIZE,
  MAX_PRODUCT_PAGE_SIZE,
  PRODUCT_SORTS,
  type ProductSort,
} from '@/lib/catalog/product-query';
import { ADMIN_PAGE_SIZE } from '@/lib/pagination';
import { normalizeSearchText } from '@/lib/catalog/search-text';
import {
  categories,
  productCategories,
  productImages,
  products,
  type NewProduct,
  type PetType,
  type Product,
  type ProductImage,
  type ProductWithImages,
} from '@/db/schema/catalog';

/**
 * What a caller supplies; the database owns the id and both timestamps, and
 * this DAO owns `search_text` — it is derived from three fields below, so a
 * caller that could set it could hide a product from the search or plant one in
 * every result.
 *
 * `extraCategoryIds` is the **additional** categories, never the primary
 * `categoryId`. This DAO is their one canonicalizer — it dedupes the list and
 * drops the primary from it — because the seed bypasses zod and two copies of
 * that rule would drift.
 */
export type ProductInput = Omit<
  NewProduct,
  'id' | 'createdAt' | 'updatedAt' | 'searchText'
> & { extraCategoryIds?: string[] };

/** A written product plus the additional categories now stored for it. */
export type ProductWithExtraCategories = Product & {
  extraCategoryIds: string[];
};

export class StockConflictError extends Error {
  constructor() {
    super('موجودی محصول تغییر کرده است؛ صفحه را تازه‌سازی و دوباره تلاش کن.');
    this.name = 'StockConflictError';
  }
}

/** The fields a shopper can find a product by. */
const SEARCHABLE_FIELDS = ['title', 'brand', 'benefit'] as const;

type SearchableFields = Pick<NewProduct, (typeof SEARCHABLE_FIELDS)[number]>;

/**
 * A product's searchable text: its title, brand and benefit line as one
 * normalized string, exactly as `products.search_text` holds it.
 *
 * `description` is not in it. Trigram similarity is measured over the whole
 * stored string, so a paragraph of prose would push the words a shopper
 * actually types down into the noise of the ones they never would.
 */
export const buildProductSearchText = (product: SearchableFields): string =>
  normalizeSearchText(
    SEARCHABLE_FIELDS.map((field) => product[field])
      .filter((part) => part)
      .join(' '),
  );

/**
 * How close a term has to be to count as a match, as
 * `pg_trgm.word_similarity_threshold`.
 *
 * Measured against the seed catalogue rather than guessed. Real queries land
 * between 0.64 and 1.0 — an exact phrase, a Latin brand with a typo (0.83), a
 * dropped letter (0.69), a substituted one (0.64). Text that should not match
 * lands at 0.40 and below — the same query typed with Arabic letters and *not*
 * normalized scores 0.40, unrelated Persian words 0.17, Latin nonsense 0.
 * 0.45 sits in that gap. Below about 0.40 a two-letter Persian query starts
 * matching every word that merely begins with the same letter; above about 0.6
 * — the extension's own default — a single mistyped character stops matching,
 * which is precisely the case this story exists to serve.
 */
const SEARCH_SIMILARITY_THRESHOLD = '0.45';

/**
 * The threshold, set for one transaction.
 *
 * It has to be a GUC because that is the only thing the `%>` operator reads,
 * and it has to be the operator rather than a bare `word_similarity(…) >= x`
 * because only the operator can use the GIN trigram index. `set_config(…,
 * true)` is transaction-local, so a pooled connection is handed back with the
 * server default intact.
 */
const applySearchThreshold = sql`select set_config('pg_trgm.word_similarity_threshold', ${SEARCH_SIMILARITY_THRESHOLD}, true)`;

// The orderings and the page-size numbers are defined in
// `@/lib/catalog/product-query` together with the query schema that enforces
// them, because the storefront's URL parser is a client module and importing
// this file would put `pg` in the browser bundle. Re-exported so the API route
// and the seed keep importing them from here — one definition, one alias.
export {
  PRODUCT_SORTS,
  DEFAULT_PRODUCT_PAGE_SIZE,
  MAX_PRODUCT_PAGE_SIZE,
  type ProductSort,
};

/**
 * Every ordering ends in `sku`, which is unique. Without that tiebreak Postgres
 * is free to return rows with equal prices in a different order per query, and
 * two products at the same price can appear on both page 1 and page 2.
 */
const ORDER_BY: Record<ProductSort, SQL[]> = {
  [PRODUCT_SORTS.NEWEST]: [desc(products.createdAt), asc(products.sku)],
  [PRODUCT_SORTS.PRICE_ASC]: [asc(products.price), asc(products.sku)],
  [PRODUCT_SORTS.PRICE_DESC]: [desc(products.price), asc(products.sku)],
};

/**
 * «Suitable for this pet» — `pet_type @> ARRAY[x]`, so a both-pets product
 * answers the cat filter and the dog filter alike, and appears exactly once
 * under each. Still one pet per query: `?pet=` is single-valued.
 */
const petFilter = (petType: PetType): SQL =>
  arrayContains(products.petTypes, [petType]);

/**
 * The ids a `?category=` slug covers: the category itself and — when it is a
 * top-level one — every sub-category under it. A sub-category's slug therefore
 * narrows to it alone, and an unknown slug covers nothing, which is what makes
 * the listing degrade to empty rather than to everything.
 *
 * A subquery rather than a join to `categories`: a join would have to become an
 * `or` over two tables the moment a product can sit in more than one category,
 * and then it would list that product twice and break `total` with it.
 */
const categoryScope = (slug: string) => {
  const parent = alias(categories, 'parent');
  return db
    .select({ id: categories.id })
    .from(categories)
    .leftJoin(parent, eq(categories.parentId, parent.id))
    .where(or(eq(categories.slug, slug), eq(parent.slug, slug)));
};

/**
 * «Filed under this slug» — as the primary category, or as one of the
 * additional ones. The only thing either list path asks about a category.
 *
 * Two subqueries under an `or`, never a join to the junction: a join would
 * return a product once per matching category, so a product in two
 * sub-categories of the filtered parent would be listed twice and counted
 * twice — the page and its `total` both wrong.
 *
 * ponytail: the `or` costs the category index — Postgres hashes both subplans
 * once and sequentially scans `products` against them. Correct `total`s are
 * worth that over a catalogue of hundreds; at tens of thousands, mirror the
 * primary into the junction behind a trigger and filter on one `IN`.
 */
const inCategoryScope = (slug: string): SQL =>
  or(
    inArray(products.categoryId, categoryScope(slug)),
    inArray(
      products.id,
      db
        .select({ id: productCategories.productId })
        .from(productCategories)
        .where(inArray(productCategories.categoryId, categoryScope(slug))),
    ),
  )!;

export type ProductFilters = {
  categorySlug?: string;
  /** One pet; a product suits it when its selection contains it. */
  petType?: PetType;
  /** Inclusive, integer Toman. */
  minPrice?: number;
  /** Inclusive, integer Toman. */
  maxPrice?: number;
  /**
   * A Persian search term as the shopper typed it — normalization happens
   * here, not in the caller, because the column it is matched against was
   * normalized by the same function on write. A term that normalizes to
   * nothing (blank, or only zero-width characters) is read as no search at
   * all, the same way an empty `categorySlug` is.
   */
  search?: string;
};

export type ProductListOptions = ProductFilters & {
  sort?: ProductSort;
  /** One-based. */
  page?: number;
  limit?: number;
};

/** One page of products plus the size of the whole filtered result. */
export type ProductPage = { items: ProductWithImages[]; total: number };

/**
 * Admin listing filters. Unlike {@link ProductFilters}, `active` is a first-class
 * filter here — the admin panel is the one read that may show soft-deleted rows,
 * so `undefined` means "both", not "active only".
 */
export type AdminProductFilters = {
  search?: string;
  categorySlug?: string;
  petType?: PetType;
  /** `undefined` = active and inactive; `true` = active only; `false` = inactive only. */
  active?: boolean;
};

/**
 * Whatever a query can run on: the pool, or a transaction on one connection of
 * it. The listing builds the same two queries either way — only a search needs
 * the transaction, and only because its threshold lives in one.
 */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export class ProductDao {
  /**
   * Storefront listing — active products only, whatever the filters say.
   *
   * `total` counts the filtered result, not the page: the storefront needs it to
   * draw page links. It is produced by a second query over the *same* where
   * clause and join, so it cannot drift from the page it describes.
   */
  static async list({
    sort = PRODUCT_SORTS.NEWEST,
    page = 1,
    limit = DEFAULT_PRODUCT_PAGE_SIZE,
    ...filters
  }: ProductListOptions = {}): Promise<ProductPage> {
    const search = filters.search ? normalizeSearchText(filters.search) : '';
    const where = and(...ProductDao.storefrontWhere({ ...filters, search }));

    const pageQuery = (on: Executor) =>
      on
        .select()
        .from(products)
        .where(where)
        .orderBy(...ORDER_BY[sort])
        .limit(limit)
        .offset((page - 1) * limit);

    const countQuery = (on: Executor) =>
      on.select({ value: count() }).from(products).where(where);

    // A search needs its similarity threshold, and that threshold only lives
    // for a transaction — so the two queries run on one connection, in order,
    // instead of in parallel. Every other listing keeps the parallel pair: the
    // shop's own catalogue browsing must not pay for the search box.
    const [rows, [counted]] = search
      ? await db.transaction(async (tx) => {
          await tx.execute(applySearchThreshold);
          return [await pageQuery(tx), await countQuery(tx)] as const;
        })
      : await Promise.all([pageQuery(db), countQuery(db)]);

    return {
      items: await ProductDao.withRelations(rows),
      total: counted.value,
    };
  }

  /**
   * The storefront's where clause. `is_active` leads it and no argument can
   * remove it — that is the single place a soft-deleted product is kept out of
   * every filter combination the listing offers.
   */
  private static storefrontWhere(filters: ProductFilters): SQL[] {
    const where: SQL[] = [eq(products.isActive, true)];
    if (filters.categorySlug) {
      where.push(inCategoryScope(filters.categorySlug));
    }
    if (filters.petType) {
      where.push(petFilter(filters.petType));
    }
    // Compared against undefined, not truthiness: a `minPrice` of 0 is a real
    // bound, even if the price check makes it a no-op.
    if (filters.minPrice !== undefined) {
      where.push(gte(products.price, filters.minPrice));
    }
    if (filters.maxPrice !== undefined) {
      where.push(lte(products.price, filters.maxPrice));
    }
    // `%>` rather than `word_similarity(…) >= x`: same meaning, but only the
    // operator reads the trigram index (`Bitmap Index Scan on
    // products_search_text_trgm_idx`). The indexed column goes on the left —
    // `doc %> term` asks whether the *best matching stretch* of the document
    // resembles the term, which is what a short query against a whole title,
    // brand and benefit line needs. Whole-term rather than word-by-word on
    // purpose: measured against the seed catalogue, splitting the term and
    // requiring every word to clear the bar alone drops a one-letter typo from
    // 0.69 to 0.29 and fails the misspelling this story promises.
    if (filters.search) {
      where.push(sql`${products.searchText} %> ${filters.search}`);
    }
    return where;
  }

  /**
   * Admin panel listing, every matching row: includes the products a soft delete
   * hid. The content editor's link picker reads all of them; the products table
   * pages through {@link pageForAdmin} instead.
   */
  static async listForAdmin(
    filters: AdminProductFilters = {},
  ): Promise<ProductWithImages[]> {
    const rows = await ProductDao.adminRows(ProductDao.adminWhere(filters));
    return ProductDao.withRelations(rows);
  }

  /**
   * One page of the admin listing plus the size of the whole filtered result,
   * for the products table's pager. Same filters and order as
   * {@link listForAdmin}. The page and the count run in parallel: the admin
   * search is a plain ILIKE, so it needs no transaction.
   */
  static async pageForAdmin({
    page = 1,
    limit = ADMIN_PAGE_SIZE,
    ...filters
  }: AdminProductFilters & {
    /** One-based. */
    page?: number;
    limit?: number;
  } = {}): Promise<ProductPage> {
    const where = ProductDao.adminWhere(filters);
    const [rows, [counted]] = await Promise.all([
      ProductDao.adminRows(where)
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ value: count() }).from(products).where(where),
    ]);

    return {
      items: await ProductDao.withRelations(rows),
      total: counted.value,
    };
  }

  /** The admin listing's rows, newest first, before any paging. */
  private static adminRows(where: SQL | undefined) {
    return db
      .select()
      .from(products)
      .where(where)
      .orderBy(desc(products.createdAt), asc(products.sku));
  }

  /** The admin listing's where clause, shared by the full and the paged read. */
  private static adminWhere(filters: AdminProductFilters): SQL | undefined {
    const where: SQL[] = [];
    // The one filter that separates this from the storefront read: `active`
    // undefined means *both* — the admin sees soft-deleted rows by default, and
    // narrows to only-active or only-inactive on request.
    if (filters.active !== undefined) {
      where.push(eq(products.isActive, filters.active));
    }
    if (filters.categorySlug) {
      where.push(inCategoryScope(filters.categorySlug));
    }
    if (filters.petType) {
      where.push(petFilter(filters.petType));
    }
    // A plain case-insensitive substring on the normalized search text — an
    // operational lookup, not the storefront's trigram fuzziness, so it needs
    // neither the similarity GUC nor a transaction. The term is normalized the
    // same way the column was written, so Arabic vs. Persian yeh/kaf still match.
    const search = filters.search ? normalizeSearchText(filters.search) : '';
    if (search) {
      where.push(ilike(products.searchText, `%${search}%`));
    }
    return where.length > 0 ? and(...where) : undefined;
  }

  /**
   * One product by id for the admin edit form — **including inactive ones**, so
   * a soft-deleted product can still be reopened and reactivated. This is the
   * admin counterpart of `getBySlug`, which filters `is_active` and so could
   * never load a removed product; the id (not the slug) is what the admin list
   * links to.
   */
  static async findByIdForAdmin(id: string): Promise<ProductWithImages | null> {
    const rows = await db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    const [row] = await ProductDao.withRelations(rows);
    return row ?? null;
  }

  /** Storefront product page. An inactive product reads as absent. */
  static async getBySlug(slug: string): Promise<ProductWithImages | null> {
    const rows = await db
      .select()
      .from(products)
      .where(and(eq(products.slug, slug), eq(products.isActive, true)))
      .limit(1);

    const [row] = await ProductDao.withRelations(rows);
    return row ?? null;
  }

  static async create(
    input: ProductInput,
  ): Promise<ProductWithExtraCategories> {
    const { extraCategoryIds = [], ...columns } = input;
    // One transaction, so an extra category that no longer exists rolls the
    // product back with it rather than leaving a half-created row behind.
    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(products)
        // Last, so a caller reaching past `ProductInput` cannot supply its own.
        .values({ ...columns, searchText: buildProductSearchText(columns) })
        .returning();
      return {
        ...row,
        extraCategoryIds: await ProductDao.replaceExtraCategories(
          tx,
          row.id,
          row.categoryId,
          extraCategoryIds,
        ),
      };
    });
  }

  /**
   * A patch may name any subset of the fields, so the searchable text can only
   * be rebuilt from the row as it ends up — the two writes are one transaction
   * because the first one locks the row, which is what stops a concurrent
   * update from leaving a title and a search text that describe different
   * products.
   */
  static async update(
    id: string,
    patch: Partial<ProductInput>,
    expectedStock?: number,
  ): Promise<ProductWithExtraCategories | null> {
    // Split first: drizzle's `.set()` must never see `extraCategoryIds`, which
    // is not a column of `products`.
    const { extraCategoryIds, ...columns } = patch;
    return db.transaction(async (tx) => {
      const row = await ProductDao.updateColumns(
        tx,
        id,
        columns,
        expectedStock,
      );
      if (!row) return null;
      return {
        ...row,
        extraCategoryIds:
          // ponytail: a patch that omits the key leaves the extras alone — the
          // one caller (the admin PUT) always sends the full body, a stray
          // primary in the junction is harmless to the filter and the count,
          // and the next full write strips it. `row.categoryId` is the primary
          // *after* the update, so a category promoted to primary in this very
          // write loses its junction row.
          extraCategoryIds === undefined
            ? await ProductDao.readExtraCategories(tx, id)
            : await ProductDao.replaceExtraCategories(
                tx,
                id,
                row.categoryId,
                extraCategoryIds,
              ),
      };
    });
  }

  /** Today's column logic, unchanged, inside the caller's transaction. */
  private static async updateColumns(
    tx: Executor,
    id: string,
    patch: Partial<Omit<ProductInput, 'extraCategoryIds'>>,
    expectedStock?: number,
  ): Promise<Product | null> {
    // A form round-trips stock even when only its title was edited. Preserve
    // concurrent reservations unless the operator actually changed inventory.
    const update = { ...patch };
    let stockGuard: number | undefined;
    if (expectedStock !== undefined && update.stock !== undefined) {
      if (update.stock === expectedStock) {
        delete update.stock;
      } else {
        stockGuard = expectedStock;
      }
    }
    if (Object.keys(update).length === 0) {
      const [current] = await tx
        .select()
        .from(products)
        .where(eq(products.id, id));
      return current ?? null;
    }
    const [row] = await tx
      .update(products)
      .set(update)
      .where(
        stockGuard === undefined
          ? eq(products.id, id)
          : and(eq(products.id, id), eq(products.stock, stockGuard)),
      )
      .returning();

    if (!row) {
      if (stockGuard === undefined) return null;
      // The CAS intentionally combines "missing" and "stale" into zero rows;
      // split them only on this failure path for the API's 404/409 contract.
      const [existing] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.id, id));
      if (!existing) return null;
      throw new StockConflictError();
    }
    if (!SEARCHABLE_FIELDS.some((field) => field in update)) return row;

    const [rewritten] = await tx
      .update(products)
      .set({ searchText: buildProductSearchText(row) })
      .where(eq(products.id, id))
      .returning();
    return rewritten;
  }

  /**
   * The only removal path there is: the row stays, the storefront stops seeing
   * it, the admin panel still does.
   */
  static async softDelete(
    id: string,
  ): Promise<ProductWithExtraCategories | null> {
    const [row] = await db
      .update(products)
      .set({ isActive: false })
      .where(eq(products.id, id))
      .returning();
    if (!row) return null;
    return {
      ...row,
      extraCategoryIds: await ProductDao.readExtraCategories(db, id),
    };
  }

  /**
   * Loads products by id, **including soft-deleted ones**. Checkout (story 14)
   * composes this: it loads each ordered line fresh to reject a missing or
   * inactive product before it reserves any stock, and an active-only read could
   * never surface the `isActive: false` it must reject on. Every other read here
   * filters `is_active` — this is the one that must not, so it is named for the
   * one caller that needs the whole row.
   *
   * Takes an `Executor` so checkout can read inside its transaction. An empty id
   * list short-circuits — `inArray(col, [])` is an always-false clause worth no
   * round-trip. Order is not guaranteed; callers key by id, they do not rely on
   * position.
   */
  static async getByIds(executor: Executor, ids: string[]): Promise<Product[]> {
    if (ids.length === 0) return [];
    return executor.select().from(products).where(inArray(products.id, ids));
  }

  /**
   * The oversell guard, as one atomic statement:
   * `UPDATE products SET stock = stock - qty WHERE id = ? AND stock >= qty
   * RETURNING`. Two checkouts racing for the last unit cannot both win —
   * Postgres serializes the row's update and re-checks `stock >= qty` against the
   * committed row, not a stale read, so the loser matches no row. Returns the
   * updated product, or `null` when stock was insufficient (or the id unknown);
   * the caller turns that `null` into an out-of-stock answer, not an order it
   * cannot fill. The `products_stock_non_negative` CHECK is the backstop under
   * this — see the catalog schema.
   *
   * `executor` runs it inside checkout's transaction, so a later failure there
   * releases the reserved stock by rollback. `qty` must be a positive integer: a
   * zero or negative qty makes `stock >= qty` trivially true and would *raise*
   * stock, so it is rejected outright.
   */
  static async decrementStock(
    executor: Executor,
    id: string,
    qty: number,
  ): Promise<Product | null> {
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error(
        `decrementStock requires a positive integer qty, got ${qty}`,
      );
    }
    const [row] = await executor
      .update(products)
      .set({ stock: sql`${products.stock} - ${qty}` })
      .where(and(eq(products.id, id), gte(products.stock, qty)))
      .returning();
    return row ?? null;
  }

  /**
   * Returns reserved stock to a product — the side effect of cancelling or
   * failing an order: `UPDATE products SET stock = stock + qty WHERE id = ?`.
   * Runs inside the transition's transaction so restock and the status change
   * commit together. Returns the updated product, or `null` for an unknown id.
   */
  static async restock(
    executor: Executor,
    id: string,
    qty: number,
  ): Promise<Product | null> {
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error(`restock requires a positive integer qty, got ${qty}`);
    }
    const [row] = await executor
      .update(products)
      .set({ stock: sql`${products.stock} + ${qty}` })
      .where(eq(products.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Insert-or-update by sku, which is what makes the seed re-runnable.
   * `isActive` is deliberately absent from the update: re-seeding must not
   * resurrect a product somebody removed on purpose.
   */
  static async upsertBySku(
    input: ProductInput,
  ): Promise<ProductWithExtraCategories> {
    const { extraCategoryIds = [], ...columns } = input;
    const searchText = buildProductSearchText(columns);

    // The extras are replaced wholesale on a re-seed, exactly as the images
    // are — so a corrected seed is the truth, and a re-run stacks nothing.
    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(products)
        .values({ ...columns, searchText })
        .onConflictDoUpdate({
          target: products.sku,
          set: {
            title: columns.title,
            slug: columns.slug,
            brand: columns.brand ?? null,
            description: columns.description ?? null,
            benefit: columns.benefit ?? null,
            price: columns.price,
            oldPrice: columns.oldPrice ?? null,
            stock: columns.stock ?? 0,
            categoryId: columns.categoryId,
            petTypes: columns.petTypes,
            // On the update branch too, or a corrected title in the seed would
            // never reach the index — the row would keep the text it was first
            // inserted with, and re-running the seed would look like a no-op.
            searchText,
          },
        })
        .returning();
      return {
        ...row,
        extraCategoryIds: await ProductDao.replaceExtraCategories(
          tx,
          row.id,
          row.categoryId,
          extraCategoryIds,
        ),
      };
    });
  }

  /**
   * Replaces a product's gallery wholesale — position in `objectKeys` becomes
   * `sortOrder`. Replacing rather than appending is what keeps a re-run of the
   * seed from stacking duplicate images.
   */
  static async setImages(
    productId: string,
    objectKeys: string[],
  ): Promise<ProductImage[]> {
    return db.transaction(async (tx) => {
      await tx
        .delete(productImages)
        .where(eq(productImages.productId, productId));

      if (objectKeys.length === 0) return [];

      return tx
        .insert(productImages)
        .values(
          objectKeys.map((objectKey, index) => ({
            productId,
            objectKey,
            sortOrder: index,
          })),
        )
        .returning();
    });
  }

  /**
   * Replaces a product's additional categories wholesale — position in `ids`
   * becomes `sortOrder`, which is what makes the form, the stored rows and the
   * product page's spec row agree on an order. The `product_images` pattern.
   *
   * This is the one canonicalizer: a repeated id keeps its first position and
   * the primary category is dropped, because «an extra is never the primary»
   * spans two tables and so cannot be a CHECK. Returns what was stored.
   */
  private static async replaceExtraCategories(
    tx: Executor,
    productId: string,
    primaryId: string,
    ids: readonly string[],
  ): Promise<string[]> {
    await tx
      .delete(productCategories)
      .where(eq(productCategories.productId, productId));

    const extras = [...new Set(ids)].filter((id) => id !== primaryId);
    if (extras.length === 0) return [];

    await tx.insert(productCategories).values(
      extras.map((categoryId, index) => ({
        productId,
        categoryId,
        sortOrder: index,
      })),
    );
    return extras;
  }

  /** One product's additional categories, in the order they were added. */
  private static async readExtraCategories(
    on: Executor,
    productId: string,
  ): Promise<string[]> {
    const rows = await on
      .select({ categoryId: productCategories.categoryId })
      .from(productCategories)
      .where(eq(productCategories.productId, productId))
      .orderBy(asc(productCategories.sortOrder));
    return rows.map((row) => row.categoryId);
  }

  /** Two extra queries for the whole page of products, not two per product. */
  private static async withRelations(
    rows: Product[],
  ): Promise<ProductWithImages[]> {
    if (rows.length === 0) return [];
    const productIds = rows.map((row) => row.id);

    const [images, extras] = await Promise.all([
      db
        .select()
        .from(productImages)
        .where(inArray(productImages.productId, productIds))
        .orderBy(asc(productImages.sortOrder)),
      db
        .select()
        .from(productCategories)
        .where(inArray(productCategories.productId, productIds))
        .orderBy(asc(productCategories.sortOrder)),
    ]);

    const imagesOf = groupByProduct(images, (image) => image);
    const extrasOf = groupByProduct(extras, (row) => row.categoryId);

    return rows.map((row) => ({
      ...row,
      images: imagesOf.get(row.id) ?? [],
      extraCategoryIds: extrasOf.get(row.id) ?? [],
    }));
  }
}

/** Bucket rows already ordered by `sortOrder` under their product id. */
const groupByProduct = <T extends { productId: string }, V>(
  rows: T[],
  pick: (row: T) => V,
): Map<string, V[]> => {
  const byProduct = new Map<string, V[]>();
  for (const row of rows) {
    const existing = byProduct.get(row.productId);
    if (existing) existing.push(pick(row));
    else byProduct.set(row.productId, [pick(row)]);
  }
  return byProduct;
};
