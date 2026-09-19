// All Drizzle DB access goes through DAOs like this one. Multi-DAO operations
// belong in src/logic/, not in route handlers or components. Never write raw SQL.
//
// Products are soft-deleted, never removed: `order_items` snapshots a product's
// title, sku and unit price, and support needs the row behind that snapshot to
// still exist. There is deliberately no hard-delete method here — the storefront
// reads filter on `is_active` instead.
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  getTableColumns,
  inArray,
  isNull,
  max,
  min,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { db, type Executor } from '@/db';
import {
  DEFAULT_PRODUCT_PAGE_SIZE,
  MAX_PRODUCT_PAGE_SIZE,
  PRODUCT_SORTS,
  type ProductSort,
} from '@/lib/catalog/product-query';
import { ADMIN_PAGE_SIZE } from '@/lib/pagination';
import { VARIANT_MESSAGES, hasMembersMessage } from '@/lib/catalog/variant';
import { normalizeSearchText } from '@/lib/catalog/search-text';
import {
  applySearchThreshold,
  buildProductSearchText,
  familyHasMembers,
  familyInStock,
  familyMinPrice,
  familyPriceWithin,
  familyPricesVary,
  inCategoryScope,
  MEMBER_SCOPE,
  ORDER_BY,
  petFilter,
  SEARCHABLE_FIELDS,
} from './product-sql';
import {
  productCategories,
  productImages,
  products,
  type NewProduct,
  type PetType,
  type Product,
  type ProductCard,
  type ProductDetail,
  type ProductImage,
  type VariantChip,
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

/** Which family rule refused the write; the routes map it onto a form field. */
export type VariantRuleReason =
  | 'self'
  | 'unknownHead'
  | 'inactiveHead'
  | 'nested'
  | 'headNeedsLabel'
  | 'hasMembers';

/**
 * A family rule that needs to read a second row, so it can be neither a CHECK
 * nor a zod refinement. Thrown rather than returned, like
 * {@link CategoryParentError}, so no caller can write the row by ignoring it.
 */
export class ProductVariantError extends Error {
  /** `hasMembers` cannot be thrown without saying how many are in the way. */
  constructor(reason: 'hasMembers', count: number);
  constructor(reason: Exclude<VariantRuleReason, 'hasMembers'>);
  constructor(
    readonly reason: VariantRuleReason,
    count?: number,
  ) {
    super(
      reason === 'hasMembers'
        ? // The overloads above are what make this non-null: there is no way
          // to reach it without the count, and a «some members» sentence is
          // the thing this refusal most needs not to say.
          hasMembersMessage(count as number)
        : VARIANT_MESSAGES[reason],
    );
    this.name = 'ProductVariantError';
  }
}

export class StockConflictError extends Error {
  constructor() {
    super('موجودی محصول تغییر کرده است؛ صفحه را تازه‌سازی و دوباره تلاش کن.');
    this.name = 'StockConflictError';
  }
}

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
 * The searchable-text derivation lives in `./product-sql` with the rest of the
 * listing's vocabulary, and is re-exported here because the seed and this
 * DAO's own tests have always read it from this module.
 */
export { buildProductSearchText };

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

/**
 * One page of the **storefront** listing plus the size of the whole filtered
 * result — cards, so each row carries what its family costs.
 */
export type ProductPage = { items: ProductCard[]; total: number };

/**
 * One page of the **admin** listing. Plain rows: the panel shows every product,
 * members included, and edits them one at a time — it has no use for what the
 * family costs, and computing three subqueries per row to throw them away would
 * be work done for nobody.
 */
export type AdminProductPage = { items: ProductWithImages[]; total: number };

/**
 * A listing row before the relations are attached: the columns plus the three
 * family scalars, with `familyMinPrice` still the string `pg` returns for an
 * aggregate over `bigint`. Named so the page query can be annotated — selecting
 * through the `Executor` union otherwise widens the scalars away.
 */
type ProductCardRow = Product & {
  familyMinPrice: string;
  familyPricesVary: boolean;
  familyInStock: boolean;
  familyHasMembers: boolean;
};

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

    const pageQuery = (on: Executor): Promise<ProductCardRow[]> =>
      on
        // The row plus the three family scalars. `.select()` with no argument
        // would take the columns only, and the card needs what the *family*
        // costs and whether any of it is in stock.
        .select({
          ...getTableColumns(products),
          familyMinPrice,
          familyPricesVary,
          familyInStock,
          familyHasMembers,
        })
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

    const attached = await ProductDao.withRelations<ProductCardRow>(rows);

    return {
      // `min(bigint)` arrives from `pg` as a string — drizzle's `mode: 'number'`
      // maps the column, not an aggregate over it. Coerced here, once, so no
      // component ever renders «از 250000» as text or adds a price to a string.
      items: attached.map((row) => ({
        ...row,
        familyMinPrice: Number(row.familyMinPrice),
      })),
      total: counted.value,
    };
  }

  /**
   * The storefront's where clause. `is_active` leads it and no argument can
   * remove it — that is the single place a soft-deleted product is kept out of
   * every filter combination the listing offers.
   */
  private static storefrontWhere(filters: ProductFilters): SQL[] {
    const where: SQL[] = [
      eq(products.isActive, true),
      // **The whole of «one card per family».** A head points at nothing, so
      // this keeps heads and standalone products and drops the members, which
      // are reached from the head's page instead. It rides the shared clause,
      // so every listing the storefront offers — category, pet, price, search,
      // the home strips — inherits it, and `total` cannot disagree with the page.
      isNull(products.variantOf),
    ];
    if (filters.categorySlug) {
      where.push(inCategoryScope(filters.categorySlug));
    }
    if (filters.petType) {
      where.push(petFilter(filters.petType));
    }
    // Compared against undefined, not truthiness: a `minPrice` of 0 is a real
    // bound, even if the price check makes it a no-op.
    // Asked of the family, not of the head's own price: a family belongs on the
    // shelf when **one member** is inside the window. Filtering on the head
    // alone would both hide a card whose printed «از ۲۵۰٬۰۰۰» is in range and
    // keep one whose only affordable size was the member. For a standalone
    // product the family is the row itself, so this is the old behaviour.
    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      where.push(familyPriceWithin(filters.minPrice, filters.maxPrice));
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
      // The head matches, or one of its members does — «۱۰ کیلو» is written on
      // the 10kg bag, and the card the shopper must be shown is the family's.
      // The member side reads the same trigram index as the head side.
      //
      // // ponytail: an `or` with an `exists`. If the planner ever stops using
      // // the index for the inner arm, move the members' text onto the head.
      where.push(
        sql`(${products.searchText} %> ${filters.search} or exists (select 1 ${MEMBER_SCOPE} and fam.search_text %> ${filters.search}))`,
      );
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
  } = {}): Promise<AdminProductPage> {
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

  /**
   * Storefront product page. An inactive product reads as absent.
   *
   * Deliberately **without** the listing's `variant_of is null` predicate: a
   * member has its own page and its own slug, and the chips link straight to it.
   * The predicate belongs to the listing and nowhere else.
   */
  static async getBySlug(slug: string): Promise<ProductDetail | null> {
    const rows = await db
      .select()
      .from(products)
      .where(and(eq(products.slug, slug), eq(products.isActive, true)))
      .limit(1);

    const [row] = await ProductDao.withRelations(rows);
    if (!row) return null;
    return { ...row, variants: await ProductDao.familyOf(row) };
  }

  /**
   * The chips for a product's family: the head first, then its members oldest
   * first, each marked when it is the one being viewed. Empty for a standalone
   * product — «show no chips» is the absence of siblings, not a flag.
   *
   * Reads from the family's **head** id (`variantOf ?? id`), so a member's page
   * shows the whole family and not just itself. Inactive members are left out:
   * a chip that leads to a 404 is worse than a missing one.
   */
  private static async familyOf(product: Product): Promise<VariantChip[]> {
    const headId = product.variantOf ?? product.id;
    const rows = await db
      .select({
        id: products.id,
        slug: products.slug,
        label: products.variantLabel,
        variantOf: products.variantOf,
        createdAt: products.createdAt,
        price: products.price,
        stock: products.stock,
      })
      .from(products)
      .where(
        and(
          or(eq(products.id, headId), eq(products.variantOf, headId)),
          eq(products.isActive, true),
        ),
      )
      .orderBy(asc(products.createdAt), asc(products.sku));

    // A lone row is the product itself with no siblings — no family, no chips.
    if (rows.length < 2) return [];

    return rows
      .slice()
      .sort((a, b) => Number(a.variantOf != null) - Number(b.variantOf != null))
      .map((row) => ({
        id: row.id,
        slug: row.slug,
        label: row.label ?? '',
        isCurrent: row.id === product.id,
        price: row.price,
        inStock: row.stock > 0,
      }));
  }

  /**
   * The cheapest and dearest active product, for the shop's price slider.
   *
   * Over **every** active row, members included: a family's card prints its
   * cheapest member, so a slider that stopped at the heads' prices could not
   * reach a price the shop visibly shows.
   *
   * `{ min: 0, max: 0 }` on an empty catalogue — the panel reads that as «no
   * range to offer» and renders no slider, rather than one with both handles
   * pinned to zero.
   */
  static async priceBounds(): Promise<{ min: number; max: number }> {
    const [row] = await db
      .select({ min: min(products.price), max: max(products.price) })
      .from(products)
      .where(eq(products.isActive, true));

    // `pg` returns an aggregate over `bigint` as a string, as with the family
    // scalars above — drizzle's `mode: 'number'` maps the column, not a
    // function of it.
    return { min: Number(row?.min ?? 0), max: Number(row?.max ?? 0) };
  }

  /**
   * The products an admin may point a variant at: active, not themselves
   * members, and never the row being edited. Ordered by title so the select
   * reads alphabetically rather than by insertion.
   *
   * A candidate without a label of its own is still listed — the form disables
   * it with the reason, which is more useful than a head that silently is not
   * there.
   *
   * `currentHeadId` is the head the edited row already points at, and it is
   * listed even when it is soft-deleted. The select mirrors a column: a head
   * left out of the options makes the form read «هیچ‌کدام — محصول مستقل» for a
   * row whose `variant_of` says the opposite, and saving that form detaches the
   * product the admin only opened to look at. Offering the row that is actually
   * stored is the same thing the link picker does for a hidden product.
   */
  static async listVariantHeads(
    excludeId?: string,
    currentHeadId?: string | null,
  ): Promise<{ id: string; title: string; variantLabel: string | null }[]> {
    return db
      .select({
        id: products.id,
        title: products.title,
        variantLabel: products.variantLabel,
      })
      .from(products)
      .where(
        and(
          currentHeadId
            ? or(eq(products.isActive, true), eq(products.id, currentHeadId))
            : eq(products.isActive, true),
          isNull(products.variantOf),
          excludeId ? ne(products.id, excludeId) : undefined,
        ),
      )
      .orderBy(asc(products.title), asc(products.sku));
  }

  /**
   * Whether anything hangs off this product. The edit form asks so it can
   * disable the «head» select with a reason, exactly as the category manager
   * does for a category that already has children.
   */
  static async hasMembers(id: string): Promise<boolean> {
    return (await ProductDao.countActiveMembers(id)) > 0;
  }

  /** How many **active** rows point at this one. See `softDelete` for why. */
  private static async countActiveMembers(
    id: string,
    executor: Executor = db,
  ): Promise<number> {
    const [counted] = await executor
      .select({ value: count() })
      .from(products)
      .where(and(eq(products.variantOf, id), eq(products.isActive, true)));
    return counted.value;
  }

  /**
   * Refuses hiding a product that still has active members.
   *
   * Both doors route through it — the edit form's visibility checkbox via
   * {@link update}, and the panel's «حذف» button via {@link softDelete} — so
   * neither can answer the refusal differently, which is exactly how the two
   * came apart before.
   */
  private static async assertNoActiveMembers(
    executor: Executor,
    id: string,
  ): Promise<void> {
    await ProductDao.lockRow(executor, id);
    const blocking = await ProductDao.countActiveMembers(id, executor);
    if (blocking > 0) throw new ProductVariantError('hasMembers', blocking);
  }

  /**
   * Takes this row's own write lock, so a count taken after it cannot be made
   * stale by a member arriving beside it.
   *
   * Every «is anything pointing at me» guard needs this. A transaction writing
   * a member holds `for key share` on the head through its foreign key, and a
   * plain `update products set …` asks only for `for no key update`, which does
   * not conflict with it — so both writes commit and the family comes apart
   * between two statements that were each legal.
   *
   * One row, not a pair: `assertFamilyRules` has already locked this one when
   * the write names a head, and when it does not there is nothing else to take,
   * so no transaction here holds two of these locks in a disagreeing order.
   */
  private static async lockRow(executor: Executor, id: string): Promise<void> {
    await executor
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, id))
      .for('update');
  }

  /**
   * Every family rule that has to read a second row, in one place so create and
   * update cannot answer the same refusal differently.
   *
   * `id` is the row being written — absent on create, which is why «a head that
   * already has members cannot itself become a member» is checked only when
   * there is an id to have members.
   */
  private static async assertFamilyRules(
    executor: Executor,
    id: string | undefined,
    variantOf: string | null | undefined,
  ): Promise<void> {
    if (variantOf == null) return;
    if (id && variantOf === id) throw new ProductVariantError('self');

    // `for update` on the pair, in id order — `CategoryDao.assertParent`'s
    // pattern, for its reason: a guard that reads without locking is checking
    // a state another transaction is free to leave behind it. Ordering by id
    // gives the opposite moves (X under Y, Y under X) the same lock order, so
    // they cannot deadlock; there is no row to lock on a create.
    const locked = await executor
      .select({
        id: products.id,
        variantOf: products.variantOf,
        variantLabel: products.variantLabel,
        isActive: products.isActive,
      })
      .from(products)
      .where(inArray(products.id, id ? [variantOf, id] : [variantOf]))
      .orderBy(asc(products.id))
      .for('update');

    const head = locked.find((row) => row.id === variantOf);
    if (!head) throw new ProductVariantError('unknownHead');
    // One level: the head must itself be a head, not a member.
    if (head.variantOf !== null) throw new ProductVariantError('nested');
    // A soft-deleted head is not a place to hang anything: the storefront
    // drops it for `is_active` and never listed its members for
    // `variant_of is null`, so this would mint exactly the live-but-unlisted
    // row that `hasMembers` refuses to create from the other direction.
    if (!head.isActive) throw new ProductVariantError('inactiveHead');
    // A head with no label of its own renders an empty chip on the page.
    if (!head.variantLabel?.trim())
      throw new ProductVariantError('headNeedsLabel');

    if (id) {
      // The other half of one level: this row must not already have members.
      const members = await ProductDao.countActiveMembers(id, executor);
      if (members > 0) throw new ProductVariantError('nested');
    }
  }

  static async create(
    input: ProductInput,
  ): Promise<ProductWithExtraCategories> {
    const { extraCategoryIds = [], ...columns } = input;
    // One transaction, so an extra category that no longer exists rolls the
    // product back with it rather than leaving a half-created row behind.
    return db.transaction(async (tx) => {
      // Same transaction, so a head deleted between this check and the insert
      // rolls the product back with it instead of leaving an orphan behind.
      await ProductDao.assertFamilyRules(tx, undefined, columns.variantOf);
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
      // Before the write, on the same connection: the row this patch points at
      // is read and refused here, not by a constraint that cannot see it.
      await ProductDao.assertFamilyRules(tx, id, columns.variantOf);
      // Hiding a head is hiding its whole family: the members are never listed
      // on their own (`variant_of is null`), so they would stay active and
      // purchasable by URL while appearing on no shelf. `softDelete` always
      // refused this; `update` did not, and the edit form's «نمایش در فروشگاه»
      // checkbox goes through here — so the refusal on one door sent admins
      // through the other.
      if (columns.isActive === false) {
        await ProductDao.assertNoActiveMembers(tx, id);
      }
      // Clearing a head's own label would leave its chips with nothing written
      // on them — `products_variant_label_present` only covers members, and the
      // «head needs a label» guard only fires when something is *pointed at* it.
      if ('variantLabel' in columns && !columns.variantLabel?.trim()) {
        await ProductDao.lockRow(tx, id);
        if ((await ProductDao.countActiveMembers(id, tx)) > 0) {
          throw new ProductVariantError('headNeedsLabel');
        }
      }
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
    // In a transaction so the count and the write see one snapshot: on the pool
    // they were two autocommit statements, and a member created between them
    // left the orphan the guard exists to prevent.
    //
    // **Active members only.** Counting the inactive ones too would be a dead
    // end: deactivate every smell and the head could never be deactivated
    // after them, since the rows still point at it and nothing but re-pointing
    // each one by hand would clear the way. An inactive head over inactive
    // members is harmless — none of them is listed anywhere.
    return db.transaction(async (tx) => {
      await ProductDao.assertNoActiveMembers(tx, id);

      const [row] = await tx
        .update(products)
        .set({ isActive: false })
        .where(eq(products.id, id))
        .returning();
      if (!row) return null;
      return {
        ...row,
        extraCategoryIds: await ProductDao.readExtraCategories(tx, id),
      };
    });
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
            // The family shape is part of what the seed asserts, so it is part
            // of what a re-run corrects. Leaving these out while still
            // rewriting `searchText` — which is built FROM `variantLabel` —
            // made the two disagree: the row became findable by a word its own
            // page never showed, and a family broken once could never be
            // re-seeded straight. `isActive` stays out on purpose (below).
            variantOf: columns.variantOf ?? null,
            variantLabel: columns.variantLabel ?? null,
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
  private static async withRelations<T extends Product>(
    rows: T[],
  ): Promise<(T & { images: ProductImage[]; extraCategoryIds: string[] })[]> {
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
