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
 * The checkout result page for one order — where the Zarinpal callback lands the
 * browser after a payment attempt (success or failure). The page reads the order
 * server-side (owner-scoped), not from the callback's query params, so it always
 * shows the order's real settled status. Built by [[Story - Checkout Flow
 * Frontend]] at `src/app/(app)/checkout/result/[orderId]/page.tsx`.
 */
export const checkoutResultPath = (orderId: string) =>
  `${PATHS.CHECKOUT}/result/${encodeURIComponent(orderId)}`;

/**
 * The generic payment-failure page — where the callback lands when it cannot tie
 * the redirect to an order (unknown/absent authority, or a malformed callback
 * query), so there is no order id to show a result for. Distinct path from
 * `checkoutResultPath` so the two never collide. Built by [[Story - Checkout
 * Flow Frontend]] at `src/app/(app)/checkout/failed/page.tsx`.
 */
export const checkoutFailurePath = () => `${PATHS.CHECKOUT}/failed`;

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
  SHIPPING_RATES: '/api/shipping/rates',
  CHECKOUT: '/api/checkout',
  ORDERS: '/api/orders',
  // Zarinpal payment endpoints. `request` starts a payment (auth), `callback` is
  // the unauthenticated gateway redirect target, `reconcile` is the admin-run
  // expiry/verify sweep. `mockGateway`/`mockComplete` back the dev-only mock
  // gateway page and only respond when the provider is `mock`.
  PAYMENT_REQUEST: '/api/payments/zarinpal/request',
  PAYMENT_CALLBACK: '/api/payments/zarinpal/callback',
  PAYMENT_RECONCILE: '/api/payments/zarinpal/reconcile',
  PAYMENT_MOCK_GATEWAY: '/api/payments/zarinpal/mock-gateway',
  PAYMENT_MOCK_COMPLETE: '/api/payments/zarinpal/mock-complete',
} as const;

/** `/api/orders/{id}` — the OpenAPI template for the owner-scoped order read. */
export const API_ORDER_DETAIL_TEMPLATE = `${API_PATHS.ORDERS}/{id}`;

/** The owner-scoped order-detail path for one order. */
export const apiOrderPath = (id: string) =>
  `${API_PATHS.ORDERS}/${encodeURIComponent(id)}`;

/** `/api/shipping/rates/{provinceId}` — the OpenAPI template for the admin update. */
export const API_SHIPPING_RATE_TEMPLATE = `${API_PATHS.SHIPPING_RATES}/{provinceId}`;

/** The admin rate-update path for one province. */
export const apiShippingRatePath = (provinceId: number) =>
  `${API_PATHS.SHIPPING_RATES}/${provinceId}`;

/** `/api/products/{slug}` — the OpenAPI template, as it appears in the doc. */
export const API_PRODUCT_DETAIL_TEMPLATE = `${API_PATHS.PRODUCTS}/{slug}`;

/** The storefront's product detail path for one product. */
export const apiProductPath = (slug: string) =>
  `${API_PATHS.PRODUCTS}/${encodeURIComponent(slug)}`;
