// The SQL vocabulary the product listing is built from: the searchable-text
// derivation and its similarity threshold, the family scalars a storefront
// card reads, the orderings, and the two scopes behind the category and pet
// filters. No methods and no transactions — `ProductDao` composes all of it.
//
// Split out of that file because it was the one part of it with nothing in it
// that runs: 1161 lines carrying eight unrelated concerns, and the cost was
// visible in review — the guard that refuses to hide a family head sat ~500
// lines from the other door onto the same rule, which is how one of them came
// to exist without the other.
//
// Still «never raw SQL outside the DAO layer»: this module is part of that
// layer, and nothing but `ProductDao` and its own tests may import it.
import {
  arrayContains,
  asc,
  desc,
  eq,
  inArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/db';
import { PRODUCT_SORTS, type ProductSort } from '@/lib/catalog/product-query';
import { normalizeSearchText } from '@/lib/catalog/search-text';
import {
  categories,
  productCategories,
  products,
  type NewProduct,
  type PetType,
} from '@/db/schema/catalog';

/** The fields a shopper can find a product by. */
// `variantLabel` is in here so «۱۰ کیلو» finds the 10kg bag through the member's
// *own* search text. Nothing recomputes a head's text when a member changes:
// the storefront's search clause reaches the members instead, which is one
// query rather than a cross-row write with a re-parenting cleanup behind it.
export const SEARCHABLE_FIELDS = [
  'title',
  'brand',
  'benefit',
  'variantLabel',
] as const;

export type SearchableFields = Pick<
  NewProduct,
  (typeof SEARCHABLE_FIELDS)[number]
>;

/**
 * A product's searchable text: every field in {@link SEARCHABLE_FIELDS} as one
 * normalized string, exactly as `products.search_text` holds it — its title,
 * brand and benefit line, and its own «نوع» if it has one, so «۱۰ کیلو» finds
 * the 10kg bag through the member's row rather than the head's.
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
export const SEARCH_SIMILARITY_THRESHOLD = '0.45';

/**
 * The threshold, set for one transaction.
 *
 * It has to be a GUC because that is the only thing the `%>` operator reads,
 * and it has to be the operator rather than a bare `word_similarity(…) >= x`
 * because only the operator can use the GIN trigram index. `set_config(…,
 * true)` is transaction-local, so a pooled connection is handed back with the
 * server default intact.
 */
export const applySearchThreshold = sql`select set_config('pg_trgm.word_similarity_threshold', ${SEARCH_SIMILARITY_THRESHOLD}, true)`;

/**
 * The four numbers a storefront card needs about the whole family, each as a
 * **scalar subquery** over `products` aliased `fam`.
 *
 * Subqueries, never a join — the same trap the additional-categories work paid
 * for: joining the members multiplies the row and `total` starts counting a
 * three-size family three times. A scalar subquery returns one value per row, so
 * the page query and the count query stay the two halves of one truth.
 *
 * `fam.id = products.id or fam.variant_of = products.id` is «this row and its
 * members». A standalone product matches only itself, so it reads its own price,
 * no variation and its own stock — a caller that knows nothing about families
 * still gets the truth. Inactive members are left out of all three: a
 * soft-deleted 5kg must not set the «از …» price of a card nobody can buy it from.
 *
 * // ponytail: three correlated subqueries per listed row, which the
 * // `products_variant_of_idx` index serves. At tens of thousands of products,
 * // denormalize the family's min price onto the head behind a trigger.
 */
// **Every correlated reference to the outer row goes through a nested `sql`
// fragment like these two, never inlined into the scalar's own template.**
// Drizzle renders `${products.id}` unqualified — as bare `"id"` — when it sits
// directly in a select field, and inside `from products fam` that binds to
// `fam.id` instead of the outer row: `fam.variant_of = fam.id` is false for
// every row, silently, with no error and a plausible-looking result. Nesting
// the fragment is what makes drizzle emit `"products"."id"`.
export const FAMILY_SCOPE = sql`from products fam where (fam.id = ${products.id} or fam.variant_of = ${products.id}) and fam.is_active`;

/** «The members of this row», for the one scalar that must exclude the row. */
export const MEMBER_SCOPE = sql`from products fam where fam.variant_of = ${products.id} and fam.is_active`;

/** Integer Toman. `bigint` comes back from `pg` as a string — coerced on read. */
export const familyMinPrice = sql<string>`(select min(fam.price) ${FAMILY_SCOPE})`;

/**
 * «Some member of this family costs between these two», as one `exists` over
 * the family scope.
 *
 * One subquery rather than a bound apiece, because two would be satisfied by
 * two *different* members — «someone costs at least ۱۶۰٬۰۰۰» and «someone
 * costs at most ۱۷۰٬۰۰۰» are both true of a family priced ۱۴۹٬۰۰۰ and
 * ۱۸۵٬۰۰۰, which is how the old pair of comparisons put a card with nothing in
 * the window onto the shelf. Either bound may be absent; the caller only asks
 * when at least one is set.
 */
export const familyPriceWithin = (min?: number, max?: number): SQL => {
  const bounds: SQL[] = [];
  if (min !== undefined) bounds.push(sql`fam.price >= ${min}`);
  if (max !== undefined) bounds.push(sql`fam.price <= ${max}`);
  return sql`exists (select 1 ${FAMILY_SCOPE} and ${sql.join(bounds, sql` and `)})`;
};

/** `min <> max` — what makes a card read «از …» rather than a plain price. */
export const familyPricesVary = sql<boolean>`(select min(fam.price) <> max(fam.price) ${FAMILY_SCOPE})`;

/** Any member with stock. A sold-out head must not hide an in-stock 10kg. */
export const familyInStock = sql<boolean>`(exists (select 1 ${FAMILY_SCOPE} and fam.stock > 0))`;

/**
 * Whether anything hangs off this row. The card needs it even when the prices
 * all agree: quick-adding the head would silently choose «لاوندر» for a shopper
 * who never picked a smell, so a family sends them to the page instead.
 */
export const familyHasMembers = sql<boolean>`(exists (select 1 ${MEMBER_SCOPE}))`;

/**
 * Every ordering ends in `sku`, which is unique. Without that tiebreak Postgres
 * is free to return rows with equal prices in a different order per query, and
 * two products at the same price can appear on both page 1 and page 2.
 */
export const ORDER_BY: Record<ProductSort, SQL[]> = {
  [PRODUCT_SORTS.NEWEST]: [desc(products.createdAt), asc(products.sku)],
  // The family's own cheapest, not the head's price — otherwise a family whose
  // card prints «از ۱۰۰٬۰۰۰» sorts among the 900,000s and the order visibly
  // disagrees with the number printed on it.
  [PRODUCT_SORTS.PRICE_ASC]: [asc(familyMinPrice), asc(products.sku)],
  [PRODUCT_SORTS.PRICE_DESC]: [desc(familyMinPrice), asc(products.sku)],
};

/**
 * «Suitable for this pet» — `pet_type @> ARRAY[x]`, so a both-pets product
 * answers the cat filter and the dog filter alike, and appears exactly once
 * under each. Still one pet per query: `?pet=` is single-valued.
 */
export const petFilter = (petType: PetType): SQL =>
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
export const categoryScope = (slug: string) => {
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
export const inCategoryScope = (slug: string): SQL =>
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
