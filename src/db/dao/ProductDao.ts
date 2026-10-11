// All Drizzle DB access goes through DAOs like this one. Multi-DAO operations
// belong in src/logic/, not in route handlers or components. Never write raw SQL.
//
// A product that has been ordered is soft-deleted, never removed: `order_items`
// snapshots its title, sku and unit price, and support needs the row behind
// that snapshot to still exist. The storefront reads filter on `is_active`.
// `hardDelete` removes only a row nothing references — both `order_items` and
// `variant_of` restrict — and `src/logic/admin/product-removal.ts` is what
// decides between the two.
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  getTableColumns,
  inArray,
  isNull,
  like,
  lt,
  max,
  min,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, type Executor, type Tx } from '@/db';
import { escapeLike } from '@/db/dao/like-pattern';
import { pgErrorOf } from '@/db/pg-error';
import {
  DEFAULT_PRODUCT_PAGE_SIZE,
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
  familyOpenSlug,
  familyPriceWithin,
  familyPricesVary,
  inCategoryScope,
  MEMBER_SCOPE,
  ORDER_BY,
  petFilter,
  SEARCHABLE_FIELDS,
} from './product-sql';
import {
  categories,
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

/** One product as the admin insights page reads it — see `insightRows`. */
export type ProductInsightRow = {
  id: string;
  slug: string;
  title: string;
  variantOf: string | null;
  variantLabel: string | null;
  stock: number;
  isActive: boolean;
  petTypes: PetType[];
  categoryId: string;
  categoryTitle: string;
  /** The primary category's parent, or `null` for a top-level category. */
  parentCategoryTitle: string | null;
};

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

/**
 * Where a family is filed. A member does not carry its own: the shop lists
 * heads, so a member's categories and pets could never reach a shelf, and a
 * panel that offered them was offering a filing that did nothing. They are
 * copied from the head on every write that names one, and pushed back down to
 * the members whenever the head itself moves.
 */
type FamilyFiling = {
  categoryId: string;
  petTypes: PetType[];
  extraCategoryIds: string[];
};

/** One candidate head for the «زیرمجموعه‌ی» select, and what it is filed as. */
type VariantHeadRow = {
  id: string;
  title: string;
  variantLabel: string | null;
  categoryId: string;
  petTypes: PetType[];
};

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
  constructor(reason: 'hasMembers', members: number);
  constructor(reason: Exclude<VariantRuleReason, 'hasMembers'>);
  constructor(
    readonly reason: VariantRuleReason,
    members?: number,
  ) {
    super(
      reason === 'hasMembers'
        ? // The overloads above are what make this non-null: there is no way
          // to reach it without the count, and a «some members» sentence is
          // the thing this refusal most needs not to say.
          hasMembersMessage(members as number)
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

type ProductFilters = {
  categorySlug?: string;
  /** One pet; a product suits it when its selection contains it. */
  petType?: PetType;
  /** Inclusive, integer Toman. */
  minPrice?: number;
  /** Inclusive, integer Toman. */
  maxPrice?: number;
  /**
   * Only what can be bought: a family stays when any active member has stock,
   * the same `familyInStock` the card's «ناموجود» badge and the sort read.
   */
  inStock?: boolean;
  /**
   * A Persian search term as the shopper typed it — normalization happens
   * here, not in the caller, because the column it is matched against was
   * normalized by the same function on write. A term that normalizes to
   * nothing (blank, or only zero-width characters) is read as no search at
   * all, the same way an empty `categorySlug` is.
   */
  search?: string;
};

type ProductListOptions = ProductFilters & {
  sort?: ProductSort;
  /** One-based. */
  page?: number;
  limit?: number;
};

/**
 * One page of the **storefront** listing plus the size of the whole filtered
 * result — cards, so each row carries what its family costs.
 */
type ProductPage = { items: ProductCard[]; total: number };

/**
 * One page of the **admin** listing. Plain rows: the panel shows every product,
 * members included, and edits them one at a time — it has no use for what the
 * family costs, and computing three subqueries per row to throw them away would
 * be work done for nobody.
 */
type AdminProductPage = { items: ProductWithImages[]; total: number };

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
  familyOpenSlug: string;
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

/** The head's filing as the columns a write sets. */
const columnsOf = ({ categoryId, petTypes }: FamilyFiling) => ({
  categoryId,
  petTypes,
});

/** Whether a patch could have moved where a product is filed. */
const touchesFiling = (
  columns: Partial<ProductInput>,
  extraCategoryIds: string[] | undefined,
): boolean =>
  'categoryId' in columns ||
  'petTypes' in columns ||
  extraCategoryIds !== undefined;

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
      ProductDao.cardQuery(on, where)
        .orderBy(...ORDER_BY[sort])
        .limit(limit)
        .offset((page - 1) * limit);

    const countQuery = (on: Executor) => on.$count(products, where);

    // A search needs its similarity threshold, and that threshold only lives
    // for a transaction — so the two queries run on one connection, in order,
    // instead of in parallel. Every other listing keeps the parallel pair: the
    // shop's own catalogue browsing must not pay for the search box.
    const [rows, total] = search
      ? await db.transaction(async (tx) => {
          await tx.execute(applySearchThreshold);
          return [await pageQuery(tx), await countQuery(tx)] as const;
        })
      : await Promise.all([pageQuery(db), countQuery(db)]);

    return { items: await ProductDao.toCards(rows), total };
  }

  /**
   * The storefront cards for these ids, in no particular order — callers key by
   * id. The listing's own row and where clause, so an inactive product or a
   * family member does not come back; no page and no count. What the home
   * page's «انتخاب‌های اسموکی» boxes show and what the content save check
   * accepts as a pick both come from here, so the two cannot disagree about what
   * a card is.
   */
  static async cardsByIds(ids: readonly string[]): Promise<ProductCard[]> {
    if (ids.length === 0) return [];
    const rows: ProductCardRow[] = await ProductDao.cardQuery(
      db,
      and(...ProductDao.storefrontWhere({}), inArray(products.id, [...ids])),
    );
    return ProductDao.toCards(rows);
  }

  /**
   * The listing row: the columns plus the family scalars. `.select()` with no
   * argument would take the columns only, and the card needs what the *family*
   * costs and whether any of it is in stock.
   */
  private static cardQuery(on: Executor, where: SQL | undefined) {
    return on
      .select({
        ...getTableColumns(products),
        familyMinPrice,
        familyPricesVary,
        familyInStock,
        familyHasMembers,
        familyOpenSlug,
      })
      .from(products)
      .where(where);
  }

  /** Listing rows as cards: images and extra categories attached. */
  private static async toCards(rows: ProductCardRow[]): Promise<ProductCard[]> {
    const attached = await ProductDao.withRelations<ProductCardRow>(rows);
    // `min(bigint)` arrives from `pg` as a string — drizzle's `mode: 'number'`
    // maps the column, not an aggregate over it. Coerced here, once, so no
    // component ever renders «از 250000» as text or adds a price to a string.
    return attached.map((row) => ({
      ...row,
      familyMinPrice: Number(row.familyMinPrice),
    }));
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
    // shelf when a member **whose price the card prints** is inside the window
    // — an in-stock one, or any when nothing is in stock. Filtering on the head
    // alone would both hide a card whose printed «از ۲۵۰٬۰۰۰» is in range and
    // keep one whose only affordable size was the member. With the in-stock
    // filter on, the priced members are the in-stock ones, so the two filters
    // are asked of the same member. For a standalone product the family is the
    // row itself.
    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      where.push(familyPriceWithin(filters.minPrice, filters.maxPrice));
    }
    if (filters.inStock) {
      where.push(familyInStock);
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
      // ponytail: an `or` with an `exists`. If the planner ever stops using
      // the index for the inner arm, move the members' text onto the head.
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
    const [rows, total] = await Promise.all([
      ProductDao.adminRows(where)
        .limit(limit)
        .offset((page - 1) * limit),
      db.$count(products, where),
    ]);

    return {
      items: await ProductDao.withRelations(rows),
      total,
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
      where.push(ilike(products.searchText, `%${escapeLike(search)}%`));
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
   * Every active product page for `sitemap.xml`: its slug and when it last
   * changed. Members included, unlike the storefront listing: each member is a
   * page of its own, with its own price and photo.
   */
  static async listForSitemap(): Promise<{ slug: string; updatedAt: Date }[]> {
    return db
      .select({ slug: products.slug, updatedAt: products.updatedAt })
      .from(products)
      .where(eq(products.isActive, true))
      .orderBy(asc(products.slug));
  }

  /**
   * Whether a shelf lists anything, by the storefront listing's own clause
   * (active heads; a category with its sub-categories and extra filings; a
   * pet's products), so `sitemap.xml` names no shelf that answers with the
   * empty state.
   */
  static async hasShelfProducts(
    shelf: Pick<ProductFilters, 'categorySlug' | 'petType'>,
  ): Promise<boolean> {
    const [row] = await db
      .select({ id: products.id })
      .from(products)
      .where(and(...ProductDao.storefrontWhere(shelf)))
      .limit(1);
    return row !== undefined;
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
  ): Promise<VariantHeadRow[]> {
    return db
      .select({
        id: products.id,
        title: products.title,
        variantLabel: products.variantLabel,
        // The filing a member takes from it. The form needs these to send a
        // body that satisfies its own schema for a product that has no filing
        // of its own; the DAO copies them again on the way in regardless.
        categoryId: products.categoryId,
        petTypes: products.petTypes,
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

  /**
   * Which of `ids` have any member at all — active or not, since an inactive
   * member still holds `variant_of`'s restricting key. One query for a whole
   * page of the admin list.
   */
  static async idsWithMembers(
    executor: Executor,
    ids: readonly string[],
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await executor
      .selectDistinct({ headId: products.variantOf })
      .from(products)
      .where(inArray(products.variantOf, [...ids]));
    return new Set(rows.flatMap(({ headId }) => (headId ? [headId] : [])));
  }

  /** How many **active** rows point at this one. See `deactivate` for why. */
  private static async countActiveMembers(
    id: string,
    executor: Executor = db,
  ): Promise<number> {
    return executor.$count(
      products,
      and(eq(products.variantOf, id), eq(products.isActive, true)),
    );
  }

  /**
   * Refuses hiding a product that still has active members.
   *
   * Both doors route through it — the edit form's visibility checkbox via
   * {@link update}, and the panel's 🗑 via {@link deactivate} — so
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
   *
   * Answers whether the row exists: the admin's 🗑 takes this lock first and
   * turns `false` into its 404.
   */
  static async lockRow(executor: Executor, id: string): Promise<boolean> {
    const [locked] = await executor
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, id))
      .for('update');
    return locked !== undefined;
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
  ): Promise<FamilyFiling | null> {
    if (variantOf == null) return null;
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
        categoryId: products.categoryId,
        petTypes: products.petTypes,
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

    return {
      categoryId: head.categoryId,
      petTypes: head.petTypes,
      extraCategoryIds: await ProductDao.readExtraCategories(executor, head.id),
    };
  }

  /**
   * Copies a head's filing onto every member that hangs off it.
   *
   * The other half of «a family is filed once»: without it, re-filing a head
   * would leave its members on the categories they were created under, and
   * their own pages would disagree with the family's. Runs only when a write
   * actually moved a head.
   */
  private static async refileMembers(
    tx: Executor,
    headId: string,
    filing: FamilyFiling,
  ): Promise<void> {
    const members = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.variantOf, headId));
    if (members.length === 0) return;

    await tx
      .update(products)
      .set({ categoryId: filing.categoryId, petTypes: filing.petTypes })
      .where(eq(products.variantOf, headId));
    for (const member of members) {
      await ProductDao.replaceExtraCategories(
        tx,
        member.id,
        filing.categoryId,
        filing.extraCategoryIds,
      );
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
      const filing = await ProductDao.assertFamilyRules(
        tx,
        undefined,
        columns.variantOf,
      );
      // A member takes its head's filing, whatever the caller sent: the shop
      // lists heads, so its own would reach no shelf, and the two disagreeing
      // is what made the panel show a category that did nothing.
      const values = filing ? { ...columns, ...columnsOf(filing) } : columns;
      const [row] = await tx
        .insert(products)
        // Last, so a caller reaching past `ProductInput` cannot supply its own.
        .values({ ...values, searchText: buildProductSearchText(values) })
        .returning();
      return {
        ...row,
        extraCategoryIds: await ProductDao.replaceExtraCategories(
          tx,
          row.id,
          row.categoryId,
          filing ? filing.extraCategoryIds : extraCategoryIds,
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
      const filing = await ProductDao.assertFamilyRules(
        tx,
        id,
        columns.variantOf,
      );
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
        filing ? { ...columns, ...columnsOf(filing) } : columns,
        expectedStock,
      );
      if (!row) return null;
      // The head's own extras first: `refileMembers` copies what the head
      // ends up with, not what it had.
      const extras =
        extraCategoryIds === undefined
          ? // ponytail: a patch that omits the key leaves the extras alone —
            // the one caller (the admin PUT) always sends the full body, a
            // stray primary in the junction is harmless to the filter and the
            // count, and the next full write strips it.
            await ProductDao.readExtraCategories(tx, id)
          : await ProductDao.replaceExtraCategories(
              tx,
              id,
              // The primary *after* the update, so a category promoted to
              // primary in this very write loses its junction row.
              row.categoryId,
              filing ? filing.extraCategoryIds : extraCategoryIds,
            );
      // Moving a head moves its family with it, or the members would keep the
      // categories they were created under and their own pages would disagree
      // with the head's. Only when this write is about a head, and only when
      // it touched the filing.
      if (row.variantOf === null && touchesFiling(columns, extraCategoryIds)) {
        await ProductDao.refileMembers(tx, id, {
          categoryId: row.categoryId,
          petTypes: row.petTypes,
          extraCategoryIds: extras,
        });
      }
      return { ...row, extraCategoryIds: extras };
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
   * Deactivates: the row stays, the storefront stops seeing it, the admin
   * panel still does. The removal for a product that has been ordered or has
   * members; {@link hardDelete} is the one for a product nothing references.
   */
  static async softDelete(
    id: string,
  ): Promise<ProductWithExtraCategories | null> {
    // In a transaction so the count and the write see one snapshot: on the pool
    // they were two autocommit statements, and a member created between them
    // left the orphan the guard exists to prevent.
    return db.transaction((tx) => ProductDao.deactivate(tx, id));
  }

  /**
   * {@link softDelete} inside a transaction the caller already holds — the
   * admin's 🗑, which decides between this and {@link hardDelete} under one
   * row lock. Opening a second transaction there would take a second pooled
   * connection and wait on the lock its own caller holds.
   *
   * **Active members only.** Counting the inactive ones too would be a dead
   * end: deactivate every smell and the head could never be deactivated after
   * them, since the rows still point at it and nothing but re-pointing each one
   * by hand would clear the way. An inactive head over inactive members is
   * harmless — none of them is listed anywhere.
   */
  static async deactivate(
    executor: Executor,
    id: string,
  ): Promise<ProductWithExtraCategories | null> {
    await ProductDao.assertNoActiveMembers(executor, id);

    const [row] = await executor
      .update(products)
      .set({ isActive: false })
      .where(eq(products.id, id))
      .returning();
    if (!row) return null;
    return {
      ...row,
      extraCategoryIds: await ProductDao.readExtraCategories(executor, id),
    };
  }

  /**
   * Removes the row for good, with its images and extra categories, and
   * returns the image keys the delete itself took — the files the caller
   * then deletes. Never a list read before the transaction: a photo appended
   * between that read and the delete would keep its file with no row left
   * pointing at it.
   *
   * Takes a `Tx`, not an `Executor`: it runs in a savepoint of the caller's
   * transaction, which holds the row lock. `order_items.product_id` and
   * `products.variant_of` both restrict, so a row something still references
   * fails with 23503;
   * that rolls back to the savepoint, the images come back, and this answers
   * `null` with the caller's transaction still usable — the caller then
   * deactivates instead. Any other failure is rethrown.
   */
  static async hardDelete(tx: Tx, id: string): Promise<string[] | null> {
    try {
      return await tx.transaction(async (savepoint) => {
        const images = await savepoint
          .delete(productImages)
          .where(eq(productImages.productId, id))
          .returning({ objectKey: productImages.objectKey });
        // `product_categories` cascades with the row.
        await savepoint.delete(products).where(eq(products.id, id));
        return images.map((image) => image.objectKey);
      });
    } catch (error) {
      if (pgErrorOf(error)?.code === '23503') return null;
      throw error;
    }
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
   * The product facts the admin insights page (`src/logic/admin/product-insights.ts`)
   * puts beside its sales and views: the display fields, stock, pets, and the
   * primary category with its parent's title. Looks up by id (what sold) **or**
   * slug (what Umami saw), **including soft-deleted rows**: a product sold in
   * the window and deactivated since still belongs in that window's report.
   * Both lists empty short-circuits.
   */
  static async insightRows({
    ids,
    slugs,
  }: {
    ids: readonly string[];
    slugs: readonly string[];
  }): Promise<ProductInsightRow[]> {
    if (ids.length === 0 && slugs.length === 0) return [];
    const parent = alias(categories, 'parent');
    const matches: SQL[] = [];
    if (ids.length > 0) matches.push(inArray(products.id, [...ids]));
    if (slugs.length > 0) matches.push(inArray(products.slug, [...slugs]));
    return db
      .select({
        id: products.id,
        slug: products.slug,
        title: products.title,
        variantOf: products.variantOf,
        variantLabel: products.variantLabel,
        stock: products.stock,
        isActive: products.isActive,
        petTypes: products.petTypes,
        categoryId: products.categoryId,
        categoryTitle: categories.title,
        parentCategoryTitle: parent.title,
      })
      .from(products)
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .leftJoin(parent, eq(parent.id, categories.parentId))
      .where(or(...matches));
  }

  /**
   * The oversell guard, as one atomic statement:
   * `UPDATE products SET stock = stock - qty WHERE id = ? AND stock >= qty
   * RETURNING`. Two checkouts racing for the last unit cannot both win —
   * Postgres serializes the row's update and re-checks `stock >= qty` against the
   * committed row, not a stale read, so the loser matches no row. Returns the
   * updated product, or `null` when stock was insufficient or the row is gone;
   * checkout re-reads the row to tell those apart, answering out of stock for
   * an active product and unavailable for a deleted or deactivated one, never
   * an order it cannot fill. The `products_stock_non_negative` CHECK is the backstop under
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
   * Switches off the active products a killed test run left behind — the
   * `test-…` rows of the integration fixtures and the `e2e-…` rows of the
   * catalog spec — so they stop filling the storefront's shelves. Returns how
   * many it switched off. Called by `pnpm seed-catalog` and vitest's
   * globalSetup.
   *
   * Only rows untouched for an hour, by `updated_at`: a run going on right now
   * has its fresh fixtures left alone — even the ones inserted with a backdated
   * `created_at` to pin a newest-first ordering, which `pnpm seed-catalog` (the
   * e2e server's boot) would otherwise switch off under a concurrent vitest
   * run. Deliberately a bulk update past `assertNoActiveMembers` — a test
   * family's members carry the same prefix, so no head goes inactive over a
   * live member.
   */
  static async deactivateStaleTestProducts(): Promise<number> {
    const rows = await db
      .update(products)
      .set({ isActive: false })
      .where(
        and(
          eq(products.isActive, true),
          or(like(products.slug, 'test-%'), like(products.slug, 'e2e-%')),
          lt(products.updatedAt, new Date(Date.now() - 60 * 60 * 1000)),
        ),
      )
      .returning({ id: products.id });
    return rows.length;
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
   *
   * Reports the keys it removed, which is the only trustworthy account of
   * them. A caller that works out its own delete set from a list it read
   * *before* this transaction will miss anything appended in between: the
   * `DELETE` takes those rows too, and the caller then keeps their files with
   * nothing left pointing at them, since the only sweep derives its work from
   * `product_images`. The rows are gone either way — a wholesale replace is
   * last-write-wins by construction — but the files need not be stranded.
   *
   * Takes the product's row lock first, as {@link appendImage} and the
   * admin's hard delete do, and answers `null` when the product is gone —
   * deleted after the caller read it — having written nothing, where the
   * INSERT would otherwise fail on the foreign key.
   */
  static async setImages(
    productId: string,
    objectKeys: string[],
  ): Promise<{ images: ProductImage[]; removedKeys: string[] } | null> {
    return db.transaction(async (tx) => {
      if (!(await ProductDao.lockRow(tx, productId))) return null;

      const removed = await tx
        .delete(productImages)
        .where(eq(productImages.productId, productId))
        .returning({ objectKey: productImages.objectKey });

      const kept = new Set(objectKeys);
      const removedKeys = removed
        .map((row) => row.objectKey)
        .filter((objectKey) => !kept.has(objectKey));

      if (objectKeys.length === 0) return { images: [], removedKeys };

      const images = await tx
        .insert(productImages)
        .values(
          objectKeys.map((objectKey, index) => ({
            productId,
            objectKey,
            sortOrder: index,
          })),
        )
        .returning();
      return { images, removedKeys };
    });
  }

  /**
   * Append one image to a product's gallery, refusing once it holds `max`.
   * Returns the stored row, or why it stored nothing: `'full'` at the ceiling,
   * `'gone'` when the product was deleted after the caller read it. Either way
   * the caller still holds a file nothing references; the two are told apart
   * because the upload route answers them differently (400 and 404).
   *
   * Atomic where an append built on `setImages` cannot be. `setImages` replaces
   * the list, so an append on top of it has to read the current keys first, and
   * two uploads racing both read the same list, both write their file and the
   * last write wins. The loser's file then sits on disk with no row and nothing
   * that will ever collect it: the only deleter works out what to delete from
   * `product_images`, so a file with no row there is invisible to it forever.
   * Locking the product row makes the readers queue, so the second sees the
   * first's image and refuses at the ceiling instead of overwriting it.
   *
   * The route still checks the ceiling before it reads the body — that is the
   * fast path that keeps a refused photo from being buffered at all. This is
   * the one that holds when two uploads race.
   *
   * A gallery-order write takes the same row lock, so the two queue, but the
   * order write replaces the list wholesale: a photo appended before it whose
   * key the admin's list does not name loses its row to it. What it must
   * never lose is the *file*, which is why `setImages` reports the keys it
   * removed.
   */
  static async appendImage(
    productId: string,
    objectKey: string,
    limit: number,
  ): Promise<ProductImage | 'full' | 'gone'> {
    return db.transaction(async (tx) => {
      if (!(await ProductDao.lockRow(tx, productId))) return 'gone';

      const existing = await tx
        .select({ sortOrder: productImages.sortOrder })
        .from(productImages)
        .where(eq(productImages.productId, productId));

      if (existing.length >= limit) return 'full';

      const [row] = await tx
        .insert(productImages)
        .values({
          productId,
          objectKey,
          // One past the highest, never the count: the two agree only while the
          // orders are gapless, and nothing here may assume that of a gallery
          // some other write has been reordering.
          sortOrder: existing.reduce(
            (highest, image) => Math.max(highest, image.sortOrder + 1),
            0,
          ),
        })
        .returning();
      return row;
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

  /**
   * Each product's first photo by `sortOrder` — an order's line photos. An
   * order outlives its product's listing, so a soft-deleted product counts; a
   * product with no photo is simply absent.
   */
  static async coverImageKeys(
    productIds: readonly string[],
  ): Promise<Map<string, string>> {
    if (productIds.length === 0) return new Map();
    const images = await db
      .select({
        productId: productImages.productId,
        objectKey: productImages.objectKey,
      })
      .from(productImages)
      .where(inArray(productImages.productId, [...productIds]))
      .orderBy(asc(productImages.sortOrder), asc(productImages.createdAt));
    // Ordered, so the first key kept per product is its cover.
    const keys = new Map<string, string>();
    for (const { productId, objectKey } of images) {
      if (!keys.has(productId)) keys.set(productId, objectKey);
    }
    return keys;
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

    // `Map.groupBy` keeps each bucket in input order, i.e. by `sortOrder`.
    const imagesOf = Map.groupBy(images, (image) => image.productId);
    const extrasOf = Map.groupBy(extras, (row) => row.productId);

    return rows.map((row) => ({
      ...row,
      images: imagesOf.get(row.id) ?? [],
      extraCategoryIds: (extrasOf.get(row.id) ?? []).map((e) => e.categoryId),
    }));
  }
}
