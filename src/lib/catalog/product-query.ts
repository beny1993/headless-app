// The product listing's query contract — the catalog's enums, its page-size
// numbers, and the zod schema that says what a filtered, sorted, paginated
// product request may contain. One definition, used by both sides of the wire:
// `GET /api/products` validates requests with it, and the shop listing's URL
// parser (`src/features/storefront/shop/shop-query.ts`) derives its own lenient
// reading of `/shop?…` from these very field schemas rather than restating the
// bounds and hoping the two stay in step.
//
// **Nothing in this file may import drizzle, `pg` or `@hono/zod-openapi`.**
// That is not tidiness, it is the reason the file exists. The shop's parser is
// pulled into a `'use client'` component, so a value import of the DAO or the
// route puts `pg` in the browser bundle and `next build` fails with
// `Module not found: Can't resolve 'dns'`. Plain zod is safe in both places;
// the OpenAPI descriptions are added by the route, which is the only side that
// has `@hono/zod-openapi` loaded (see the note in `../hono/envelope.ts` for why
// `z` still comes from `zod` there).
import { z } from 'zod';

/** The `pet_type` column's domain. Never compare against bare strings. */
export const PET_TYPES = {
  CAT: 'cat',
  DOG: 'dog',
} as const;

export type PetType = (typeof PET_TYPES)[keyof typeof PET_TYPES];

/** The orderings the storefront offers. Never compare against bare strings. */
export const PRODUCT_SORTS = {
  NEWEST: 'newest',
  PRICE_ASC: 'price-asc',
  PRICE_DESC: 'price-desc',
} as const;

export type ProductSort = (typeof PRODUCT_SORTS)[keyof typeof PRODUCT_SORTS];

/** Page size when the caller names none, and the ceiling the API enforces. */
export const DEFAULT_PRODUCT_PAGE_SIZE = 12;
export const MAX_PRODUCT_PAGE_SIZE = 48;

/**
 * The longest search term the catalog will look at.
 *
 * A cap rather than a truncation, for the same reason `limit` is capped: a
 * 400-character search box entry is a bug or an attack, not a shopper, and
 * answering it with the first 64 characters hides which one it was. The number
 * itself is a trigram budget — every character is one more trigram to test
 * against every row's `search_text`, and the search box is the cheapest lever a
 * stranger has on the catalog. Sixty-four characters is roughly ten Persian
 * words, past anything a product search needs.
 */
export const MAX_SEARCH_TERM_LENGTH = 64;

/**
 * Postgres rejects U+0000 inside a text parameter, so a null byte reaching a
 * query throws in the `pg` driver — and an unhandled throw answers 500. A
 * visitor-supplied null byte must instead behave as text that matches nothing:
 * stripped here, the lookup simply misses and answers like any other absent
 * row (404 for a slug, an empty listing for a filter). Stripping rather than
 * rejecting preserves the no-charset-rule stance on `productSlugSchema` below.
 *
 * It runs after `.min(1)`, so a value made of nothing but null bytes passes the
 * length check and strips to `''`. Both fields stay safe: `''` is ordinary text
 * to Postgres, so a slug lookup for it misses rather than throwing, and the DAO
 * reads an empty `categorySlug` as no category filter at all — the unfiltered
 * listing an absent parameter gets, not the empty one a wrong slug gets.
 */
const stripNullBytes = (value: string) => value.replaceAll('\u0000', '');

/**
 * The query's fields, one schema each.
 *
 * Exported as the shape rather than only as the assembled object because both
 * consumers need the fields individually: the route decorates each one with its
 * OpenAPI description, and the shop's parser wraps each one in a `.catch()` so
 * that a bad value degrades to an absent value instead of throwing.
 */
export const productListQueryShape = {
  category: z.string().min(1).transform(stripNullBytes).optional(),
  /**
   * The Persian search term, as typed.
   *
   * Deliberately *not* normalized here, though a `.transform()` would fit. The
   * DAO owns that step, because it has to run the very same function over the
   * stored `search_text` anyway and the two must never diverge — and because a
   * `q` rewritten on its way through the schema would come back to the shop's
   * search box as text the shopper did not type, fighting the input on every
   * keystroke. What travels is what was typed; what matches is normalized on
   * both sides at the last moment.
   *
   * `.min(1)` before the null-byte strip, as for `category` above: a term of
   * nothing but null bytes therefore arrives empty, and the DAO reads an empty
   * term as no search at all rather than as one that matches nothing.
   */
  q: z
    .string()
    .min(1)
    .max(MAX_SEARCH_TERM_LENGTH)
    .transform(stripNullBytes)
    .optional(),
  pet: z.enum([PET_TYPES.CAT, PET_TYPES.DOG]).optional(),
  sort: z
    .enum([
      PRODUCT_SORTS.NEWEST,
      PRODUCT_SORTS.PRICE_ASC,
      PRODUCT_SORTS.PRICE_DESC,
    ])
    .default(PRODUCT_SORTS.NEWEST),
  // Zero is a real floor — "no lower bound" — so `nonnegative`, and an empty
  // `?minPrice=` coercing to it is the same harmless no-op.
  minPrice: z.coerce.number().int().nonnegative().optional(),
  // `positive`, not `nonnegative`, and the asymmetry is deliberate. `price > 0`
  // is a CHECK constraint, so `maxPrice=0` cannot match a single product — and
  // `z.coerce.number()` reads `Number('')` as 0, which made the `?maxPrice=` an
  // empty filter field leaves behind answer with an empty shop under a perfectly
  // good 200. Rejecting the bound that can only ever match nothing turns that
  // silent emptiness into the 400 it always was.
  maxPrice: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  // Capped rather than clamped: a request for 500 products is a bug in the
  // caller, and answering it with 48 hides that bug behind a plausible page.
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PRODUCT_PAGE_SIZE)
    .default(DEFAULT_PRODUCT_PAGE_SIZE),
};

/**
 * The whole query. `.int()` is load-bearing beyond "no decimals": zod 4 caps it
 * at `Number.MAX_SAFE_INTEGER`, which is what keeps `?page=1e20` from reaching
 * Postgres as an `OFFSET` no `bigint` can hold.
 */
export const productListQuerySchema = z.object(productListQueryShape);

export type ProductListQuery = z.infer<typeof productListQuerySchema>;

/**
 * One product's identifier in a URL, for `GET /api/products/{slug}` and for the
 * storefront's `/product/[slug]` page — the two places a visitor-supplied slug
 * crosses into the catalog.
 *
 * Here rather than in the route for the same reason as everything above it: the
 * page is app code that must not import the Hono router, and a second
 * hand-written `z.string().min(1)` on the page is precisely the mirror the
 * always-zod rule forbids. The API rejects a failure with 400; the page degrades
 * it to its 404, because a page has no envelope to complain through.
 *
 * No charset rule on purpose. Only `products.slug` decides what exists, and a
 * slug shaped unlike our own must answer "no such product", not "bad request" —
 * the two are the same answer to a visitor and one of them leaks that the
 * catalog cares.
 */
export const productSlugSchema = z.string().min(1).transform(stripNullBytes);
