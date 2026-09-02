// Route paths — never hardcode route strings in components or handlers;
// import from here so renames stay one-line changes.
//
// Type-only import: erased at compile time, so nothing here drags the Hono
// router (and through it the database) into a client bundle.
import type { ProductListQuery } from '@/lib/hono/routes/catalog';

export const PATHS = {
  HOME: '/',
  SHOP: '/shop',
  PRODUCT: '/product',
  ABOUT: '/about',
  ACCOUNT: '/account',
  CHECKOUT: '/checkout',
  LOGIN: '/login',
} as const;

/** The storefront's product page for one product: `/product/cat-dry-food`. */
export const productPath = (slug: string) =>
  `${PATHS.PRODUCT}/${encodeURIComponent(slug)}`;

/**
 * The shop's filter query, borrowed from the catalog API's own query schema
 * rather than restated.
 *
 * Every deep link on the site — the home quiz, the category tiles, the routine
 * — lands on `/shop?…`, and [[Story - Shop Listing Page]] reads those params
 * straight back into `GET /api/products`. Taking the type from there means
 * renaming `pet` in the API breaks `pnpm type-check` instead of silently
 * producing links that filter nothing.
 */
export type ShopFilters = Partial<Pick<ProductListQuery, 'category' | 'pet'>>;

/**
 * `/shop`, with whatever filters are actually known.
 *
 * An unanswered question is left out entirely: `?category=` is a parameter the
 * API's schema sees and rejects, so an empty value would turn a partial answer
 * into a 400 rather than a broader search.
 */
export function shopPath(filters: ShopFilters = {}): string {
  const query = new URLSearchParams();
  if (filters.category) query.set('category', filters.category);
  if (filters.pet) query.set('pet', filters.pet);

  const search = query.toString();
  return search ? `${PATHS.SHOP}?${search}` : PATHS.SHOP;
}

export const PROTECTED_PATHS = {
  INDEX: '/admin-panel',
} as const;

export const API_PATHS = {
  DOC: '/api/doc',
  REFERENCE: '/api/reference',
  HEALTH: '/api/health',
  CATEGORIES: '/api/categories',
  PRODUCTS: '/api/products',
} as const;

/** `/api/products/{slug}` — the OpenAPI template, as it appears in the doc. */
export const API_PRODUCT_DETAIL_TEMPLATE = `${API_PATHS.PRODUCTS}/{slug}`;

/** The storefront's product detail path for one product. */
export const apiProductPath = (slug: string) =>
  `${API_PATHS.PRODUCTS}/${encodeURIComponent(slug)}`;
