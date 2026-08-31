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
// Imports here are type-only on purpose. This module is imported by a client
// component, so a value import of the DAO would drag `pg` into the browser
// bundle — but `typeof DEFAULT_PRODUCT_PAGE_SIZE` still fails `pnpm type-check`
// if the API's numbers move, which is the whole point of the aliases below.
import type {
  DEFAULT_PRODUCT_PAGE_SIZE,
  MAX_PRODUCT_PAGE_SIZE,
} from '@/db/dao/ProductDao';
import type { ProductListQuery } from '@/lib/hono/routes/catalog';
import { PATHS } from '@/lib/constant/paths';

/** Borrowed from the catalog API's query schema, never restated. */
export type ShopSort = ProductListQuery['sort'];
export type ShopPet = NonNullable<ProductListQuery['pet']>;

/** The parsed, always-valid shape the page and its controls both work in. */
export type ShopQuery = {
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

// The literals are re-declared rather than imported as values (that would ship
// the schema and the DAO to the browser), and then pinned to the API's own
// types so a rename or a new ordering breaks the build here instead of
// producing links that silently filter nothing.
const SORTS = [
  'newest',
  'price-asc',
  'price-desc',
] as const satisfies readonly ShopSort[];
const PETS = ['cat', 'dog'] as const satisfies readonly ShopPet[];

type Assert<T extends true> = T;
type Covers<Listed, All> = [Exclude<All, Listed>] extends [never]
  ? true
  : false;
type _AllSortsListed = Assert<Covers<(typeof SORTS)[number], ShopSort>>;
type _AllPetsListed = Assert<Covers<(typeof PETS)[number], ShopPet>>;

const DEFAULT_LIMIT: typeof DEFAULT_PRODUCT_PAGE_SIZE = 12;
const MAX_LIMIT: typeof MAX_PRODUCT_PAGE_SIZE = 48;

/** What `/shop` with no query means — and what `buildShopHref` leaves out. */
export const DEFAULT_SHOP_QUERY: ShopQuery = {
  sort: 'newest',
  page: 1,
  limit: DEFAULT_LIMIT,
};

/** The sort control's options: the API's orderings with their Persian labels. */
export const SHOP_SORT_OPTIONS: readonly { value: ShopSort; label: string }[] =
  [
    { value: 'newest', label: 'جدیدترین' },
    { value: 'price-asc', label: 'ارزان‌ترین' },
    { value: 'price-desc', label: 'گران‌ترین' },
  ];

/** The pet filter's options. Same two the catalog's `pet_type` enum has. */
export const SHOP_PET_OPTIONS: readonly { value: ShopPet; label: string }[] = [
  { value: 'cat', label: 'گربه' },
  { value: 'dog', label: 'سگ' },
];

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
 * A whole number inside `[min, max]`, or `undefined` for everything else —
 * blank, fractional, negative, `NaN`, `Infinity`, Persian digits, over the cap.
 *
 * Over-cap is dropped rather than clamped, deliberately: the API rejects
 * `limit=500` instead of answering with 48, because answering hides the
 * caller's bug behind a plausible-looking page. Falling back to the default is
 * the same refusal in a form a page can still render.
 *
 * `isSafeInteger`, not `isInteger`, and that is load-bearing rather than
 * fussy. `Number.isInteger(1e20)` is `true`, so `?page=1e20` used to parse and
 * reach Postgres as `OFFSET 1.2e+21` — past `bigint`, a failed query and a 500
 * on a page whose whole contract is that it never 500s. Prices go the same way
 * (`price` is a `bigint` column) and `1e21` does not even stringify as digits.
 * Above 2^53 the value is a lie anyway: `9007199254740993` parses as
 * `…92`. Zod 4's `.int()` draws the line in the same place, so this keeps the
 * page's tolerance no looser than the API contract it mirrors.
 */
function readInt(
  params: ShopSearchParams,
  key: string,
  { min, max }: { min: number; max?: number },
): number | undefined {
  const raw = readParam(params, key)?.trim();
  if (!raw) return undefined;

  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return undefined;
  if (value < min) return undefined;
  if (max !== undefined && value > max) return undefined;

  return value;
}

const isOneOf = <T extends string>(
  options: readonly T[],
  value: string | undefined,
): value is T => options.includes(value as T);

/**
 * A request's query string as shop state. Total: every input maps to a
 * renderable page, and parameters this page does not own are ignored so
 * campaign and analytics links keep working.
 */
export function parseShopQuery(params: ShopSearchParams): ShopQuery {
  const pet = readText(params, 'pet');
  const sort = readText(params, 'sort');

  return {
    category: readText(params, 'category'),
    pet: isOneOf(PETS, pet) ? pet : undefined,
    // Zero is a real floor, so `min: 0` — while a zero *ceiling* can only ever
    // match nothing (`price > 0` is a CHECK constraint), so `min: 1` there.
    minPrice: readInt(params, 'minPrice', { min: 0 }),
    maxPrice: readInt(params, 'maxPrice', { min: 1 }),
    sort: isOneOf(SORTS, sort) ? sort : DEFAULT_SHOP_QUERY.sort,
    page: readInt(params, 'page', { min: 1 }) ?? DEFAULT_SHOP_QUERY.page,
    limit:
      readInt(params, 'limit', { min: 1, max: MAX_LIMIT }) ??
      DEFAULT_SHOP_QUERY.limit,
  };
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

/**
 * The page numbers to draw links for: at most `size` of them, centred on the
 * current page and never pointing outside the catalog — including when the URL
 * asks for a page that does not exist, which is exactly when the shopper needs
 * a way back.
 */
export function shopPageWindow(
  page: number,
  totalPages: number,
  size = 5,
): number[] {
  if (totalPages < 1) return [];

  const span = Math.min(size, totalPages);
  const current = Math.min(Math.max(page, 1), totalPages);
  const start = Math.min(
    Math.max(current - Math.floor(span / 2), 1),
    totalPages - span + 1,
  );

  return Array.from({ length: span }, (_, index) => start + index);
}
