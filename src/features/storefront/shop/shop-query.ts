// The shop listing's entire URL contract: what `/shop?…` means, and how a
// change to the on-screen filters becomes the next URL. Pure — no React, no
// database, no `window` — because it is the one thing both sides need: the
// server component parses the request with it, the client filter controls build
// the next href with it, and a round-trip through the two is what makes a
// shared link and the back button land on exactly what the shopper saw.
//
// Two rules run through everything below:
//
//   * **The URL is the state.** There is no filter state in React that the URL
//     does not carry (the grid/list toggle is the sole exception, and it is a
//     view preference, not a filter).
//   * **An invalid parameter reads as an absent one.** `/shop` must render a
//     sane page for any URL a human, a crawler or a stale bookmark produces —
//     never a 500 and never a redirect loop. A bad value is dropped and the
//     next interaction writes the clean URL back.
//
// The bounds, the enums and the defaults are not written here — they are the
// catalog API's, imported from `@/lib/catalog/product-query` and reused field
// by field. That module holds the same zod schemas `GET /api/products`
// validates with, and it is deliberately free of drizzle and `pg` so this file
// can import them as *values*: a client component pulls this module into the
// browser bundle, and importing the DAO or the route directly fails
// `next build` with `pg` in a client chunk.
//
// The consequence worth stating: there is no second copy of "at most 48", "one
// based", "integer Toman" to drift. Change a bound in the API and this parser
// changes with it.
import { z } from 'zod';
import {
  PET_TYPES,
  PRODUCT_SORTS,
  normalizePetTypes,
  productListQueryShape,
  type ProductListQuery,
} from '@/lib/catalog/product-query';
import { PATHS } from '@/lib/constant/paths';

/** Borrowed from the catalog API's query schema, never restated. */
export type ShopSort = ProductListQuery['sort'];
export type ShopPet = NonNullable<ProductListQuery['pet']>;

/** The parsed, always-valid shape the page and its controls both work in. */
export type ShopQuery = {
  /**
   * The search term, exactly as the shopper typed it — Arabic letters, ZWNJ
   * and all. Normalization belongs to the DAO, which applies it to the term and
   * to the column it is matched against in the same breath; a term normalized
   * on its way through here would come back to the search box as text nobody
   * typed and fight the input on every keystroke.
   */
  q?: string;
  /** A category *slug*, and at most one — the API takes a single category. */
  category?: string;
  pet?: ShopPet;
  /** Inclusive, integer Toman. */
  minPrice?: number;
  /** Inclusive, integer Toman. */
  maxPrice?: number;
  sort: ShopSort;
  /** One-based. May point past the last page; the page renders that honestly. */
  page: number;
  limit: number;
};

/** Next hands a page's `searchParams` in this shape; `URLSearchParams` also works. */
export type ShopSearchParams =
  URLSearchParams | Record<string, string | string[] | undefined>;

/**
 * One API field, read the way `/shop` has to read it: an invalid value gets
 * exactly the answer an absent value gets.
 *
 * That fallback is not a number written down here — it is whatever the API's
 * own field produces from `undefined`, so `sort` falls back to the API's
 * default ordering, `limit` to the API's page size, and an optional filter to
 * nothing at all. The page's contract («a bad parameter reads as absent») and
 * the API's contract therefore cannot disagree by construction.
 */
const asAbsentWhenInvalid = <T>(field: z.ZodType<T>) =>
  field.catch(field.parse(undefined));

/**
 * The API's query schema with every field made forgiving. `/shop` must render
 * for any URL a stale bookmark produces, so it never throws — where the API
 * answers 400, the page answers with the default listing.
 */
const shopQuerySchema = z.object({
  q: asAbsentWhenInvalid(productListQueryShape.q),
  category: asAbsentWhenInvalid(productListQueryShape.category),
  pet: asAbsentWhenInvalid(productListQueryShape.pet),
  minPrice: asAbsentWhenInvalid(productListQueryShape.minPrice),
  maxPrice: asAbsentWhenInvalid(productListQueryShape.maxPrice),
  sort: asAbsentWhenInvalid(productListQueryShape.sort),
  page: asAbsentWhenInvalid(productListQueryShape.page),
  limit: asAbsentWhenInvalid(productListQueryShape.limit),
});

/**
 * What `/shop` with no query means — and what `buildShopHref` leaves out.
 * Read out of the schema rather than typed out again, so the shop's idea of
 * "no filters" is the API's idea of "no filters".
 */
export const DEFAULT_SHOP_QUERY: ShopQuery = shopQuerySchema.parse({});

// The label maps are keyed by the API's own unions, which is what makes them
// exhaustive: add an ordering to the catalog API and this file stops compiling
// until it has Persian copy, rather than quietly offering one option fewer.
const SORT_LABELS: Record<ShopSort, string> = {
  newest: 'جدیدترین',
  'price-asc': 'ارزان‌ترین',
  'price-desc': 'گران‌ترین',
};

/**
 * Exported because the product page's specification rows name the same enum:
 * one Persian word per `pet_type` value, in one place. Keyed by the union, so
 * a third pet type stops the build here rather than rendering a bare `cat`.
 */
export const PET_LABELS: Record<ShopPet, string> = {
  cat: 'گربه',
  dog: 'سگ',
};

/**
 * A product's whole pet selection as one Persian phrase — «گربه», «سگ» or
 * «گربه و سگ». Here rather than in the product page so that page, and whatever
 * shows the selection next, cannot invent a second wording; normalized first,
 * so the phrase does not depend on the order the row was written in.
 */
export const formatPetTypes = (petTypes: readonly ShopPet[]): string =>
  normalizePetTypes(petTypes)
    .map((pet) => PET_LABELS[pet])
    .join(' و ');

/** The sort control's options: the API's orderings with their Persian labels. */
export const SHOP_SORT_OPTIONS: readonly { value: ShopSort; label: string }[] =
  Object.values(PRODUCT_SORTS).map((value) => ({
    value,
    label: SORT_LABELS[value],
  }));

/** The pet filter's options. Same two the catalog's `pet_type` enum has. */
export const SHOP_PET_OPTIONS: readonly { value: ShopPet; label: string }[] =
  Object.values(PET_TYPES).map((value) => ({
    value,
    label: PET_LABELS[value],
  }));

/**
 * First value wins for a repeated parameter, which is what
 * `URLSearchParams.get` does — a link that accidentally says `?pet=cat&pet=dog`
 * still filters instead of erroring.
 */
function readParam(params: ShopSearchParams, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;

  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/** A trimmed, non-empty string, or nothing at all. */
function readText(params: ShopSearchParams, key: string): string | undefined {
  return readParam(params, key)?.trim() || undefined;
}

/**
 * A request's query string as shop state. Total: every input maps to a
 * renderable page, and parameters this page does not own are ignored so
 * campaign and analytics links keep working.
 *
 * The only thing done to a value before the API's schema sees it is the
 * `readText` above: pick one value, trim it, and treat blank as absent. That
 * last part is the page's own rule, not a bound — `z.coerce.number()` reads
 * `''` as 0, which would turn the empty price field a shopper just cleared
 * into a real filter. Everything after it — the enums, the integer and
 * safe-range checks, the price floors, the page-size cap, the defaults — is
 * the API's schema doing its own job.
 */
export function parseShopQuery(params: ShopSearchParams): ShopQuery {
  return shopQuerySchema.parse({
    q: readText(params, 'q'),
    category: readText(params, 'category'),
    pet: readText(params, 'pet'),
    minPrice: readText(params, 'minPrice'),
    maxPrice: readText(params, 'maxPrice'),
    sort: readText(params, 'sort'),
    page: readText(params, 'page'),
    limit: readText(params, 'limit'),
  });
}

/**
 * Shop state as the URL that reproduces it.
 *
 * Defaults are left out, so a cleared filter set, a fresh visit and a quiz deep
 * link all produce the same canonical `/shop?…` — one screen, one link. The
 * parameter order is fixed for the same reason.
 */
export function buildShopHref(query: ShopQuery): string {
  const params = new URLSearchParams();

  // First, because it is the thing the shopper asked for; the filters narrow it.
  if (query.q) params.set('q', query.q);
  if (query.category) params.set('category', query.category);
  if (query.pet) params.set('pet', query.pet);
  // Compared against undefined, not truthiness: `minPrice=0` is a bound the
  // shopper typed, and `if (query.minPrice)` would quietly drop it.
  if (query.minPrice !== undefined) {
    params.set('minPrice', String(query.minPrice));
  }
  if (query.maxPrice !== undefined) {
    params.set('maxPrice', String(query.maxPrice));
  }
  if (query.sort !== DEFAULT_SHOP_QUERY.sort) params.set('sort', query.sort);
  if (query.page !== DEFAULT_SHOP_QUERY.page) {
    params.set('page', String(query.page));
  }
  if (query.limit !== DEFAULT_SHOP_QUERY.limit) {
    params.set('limit', String(query.limit));
  }

  const search = params.toString();
  return search ? `${PATHS.SHOP}?${search}` : PATHS.SHOP;
}

/**
 * The next shop state after a control changes.
 *
 * Anything but an explicit page returns to page one: page 5 of «اسباب‌بازی» is
 * not page 5 of «اسباب‌بازی گربه», and keeping the number would drop the
 * shopper on an empty page they never asked for.
 */
export function updateShopQuery(
  query: ShopQuery,
  patch: Partial<ShopQuery>,
): ShopQuery {
  const page =
    'page' in patch
      ? (patch.page ?? DEFAULT_SHOP_QUERY.page)
      : DEFAULT_SHOP_QUERY.page;

  return { ...query, ...patch, page };
}

/**
 * Category is single-select against checkbox UI — the API takes one slug, so
 * picking another replaces it and picking the checked one clears it. Radios
 * would look equally right and lose that click-to-clear.
 */
export const toggleShopCategory = (query: ShopQuery, slug: string): ShopQuery =>
  updateShopQuery(query, {
    category: query.category === slug ? undefined : slug,
  });

/** Same single-select semantics for the pet type. */
export const toggleShopPet = (query: ShopQuery, pet: ShopPet): ShopQuery =>
  updateShopQuery(query, { pet: query.pet === pet ? undefined : pet });
