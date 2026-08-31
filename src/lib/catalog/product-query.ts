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
 * The query's fields, one schema each.
 *
 * Exported as the shape rather than only as the assembled object because both
 * consumers need the fields individually: the route decorates each one with its
 * OpenAPI description, and the shop's parser wraps each one in a `.catch()` so
 * that a bad value degrades to an absent value instead of throwing.
 */
export const productListQueryShape = {
  category: z.string().min(1).optional(),
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
