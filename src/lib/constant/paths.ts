// Route paths — never hardcode route strings in components or handlers;
// import from here so renames stay one-line changes.
//
// Type-only import: erased at compile time, so nothing here drags the Hono
// router (and through it the database) into a client bundle.
import type { ProductListQuery } from '@/lib/hono/routes/catalog';
import type { ContentArea } from '@/lib/content/site-content';

export const PATHS = {
  HOME: '/',
  SHOP: '/shop',
  PRODUCT: '/product',
  ABOUT: '/about',
  ACCOUNT: '/account',
  CHECKOUT: '/checkout',
  LOGIN: '/login',
} as const;

export const API_ROOT = '/api';

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
  PRODUCTS: '/admin-panel/products',
  ORDERS: '/admin-panel/orders',
  /** The discount-code manager — «کدهای تخفیف» in the sidebar. */
  DISCOUNTS: '/admin-panel/discounts',
  /** The shipping-rate editor — «نرخ ارسال» in the sidebar. */
  SHIPPING: '/admin-panel/shipping',
  /** The storefront content editor — «محتوای سایت» in the sidebar. The base
   *  redirects to the home area; the real pages are `/admin-panel/content/[area]`. */
  CONTENT: '/admin-panel/content',
} as const;

/** The content editor page for one area: `/admin-panel/content/home`. */
export const adminContentAreaPath = (area: ContentArea) =>
  `${PROTECTED_PATHS.CONTENT}/${area}`;

/** The admin "new product" form page. */
export const adminNewProductPath = () => `${PROTECTED_PATHS.PRODUCTS}/new`;

/** The admin edit-product form page for one product, by id. */
export const adminEditProductPath = (id: string) =>
  `${PROTECTED_PATHS.PRODUCTS}/${encodeURIComponent(id)}`;

/** The admin order-detail page for one order, by uuid id. */
export const adminOrderPath = (id: string) =>
  `${PROTECTED_PATHS.ORDERS}/${encodeURIComponent(id)}`;

export const API_PATHS = {
  DOC: '/api/doc',
  REFERENCE: '/api/reference',
  HEALTH: '/api/health',
  CATEGORIES: '/api/categories',
  PRODUCTS: '/api/products',
  // Admin product CRUD. A dedicated `/admin/*` prefix, not `/products/*`, because
  // the guard is mounted with `app.use('/admin/*', requireAdmin)` — method-
  // agnostic — and guarding `/products/:id` that way would also 403 the public
  // `GET /products/{slug}`. Nothing public lives under `/admin`.
  ADMIN_PRODUCTS: '/api/admin/products',
  // Admin order management — read one order (admin projection) and transition it.
  // Same `/admin/*` prefix and `requireAdmin` guard as the product routes.
  ADMIN_ORDERS: '/api/admin/orders',
  // Admin discount codes — create + toggle active. Same `/admin/*` guard.
  ADMIN_DISCOUNTS: '/api/admin/discounts',
  // Admin province management — create + activate/deactivate. Same `/admin/*`
  // guard; deliberately not under `/shipping/rates`, where a method-agnostic
  // guard would also 403 the public `GET /shipping/rates` checkout reads.
  ADMIN_PROVINCES: '/api/admin/provinces',
  // Admin storefront content — replace one block by key, and a shared image
  // upload. Same `/admin/*` guard. No public content GET: the storefront reads
  // through the DAO in server components, as the home page already does.
  ADMIN_CONTENT: '/api/admin/content',
  ADMIN_CONTENT_IMAGES: '/api/admin/content/images',
  SHIPPING_RATES: '/api/shipping/rates',
  CHECKOUT: '/api/checkout',
  // Read-only preview of the SERVER-computed discount for the current cart + code,
  // so the checkout page can show the amount before submit. Never creates an order.
  CHECKOUT_PREVIEW: '/api/checkout/preview',
  ORDERS: '/api/orders',
  // Authenticated, owner-scoped customer routes. The user id is always taken from
  // the session, never from these paths — the `{id}` in a pet/address path is the
  // resource, and the DAO's `WHERE` also demands the row's `user_id` match.
  ME_ORDERS: '/api/me/orders',
  ME_PETS: '/api/me/pets',
  ME_ADDRESSES: '/api/me/addresses',
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

/** `/api/admin/orders/{id}` — the OpenAPI template for the admin order read. */
export const API_ADMIN_ORDER_TEMPLATE = `${API_PATHS.ADMIN_ORDERS}/{id}`;

/** The admin order-read path for one order, by id. */
export const apiAdminOrderPath = (id: string) =>
  `${API_PATHS.ADMIN_ORDERS}/${encodeURIComponent(id)}`;

/** `/api/admin/orders/{id}/transitions` — the OpenAPI template for a status change. */
export const API_ADMIN_ORDER_TRANSITIONS_TEMPLATE = `${API_PATHS.ADMIN_ORDERS}/{id}/transitions`;

/** The admin status-transition path for one order, by id. */
export const apiAdminOrderTransitionsPath = (id: string) =>
  `${API_PATHS.ADMIN_ORDERS}/${encodeURIComponent(id)}/transitions`;

/** `/api/admin/discounts/{id}` — the OpenAPI template for the toggle route. */
export const API_ADMIN_DISCOUNT_TEMPLATE = `${API_PATHS.ADMIN_DISCOUNTS}/{id}`;

/** The admin toggle path for one discount code, by id. */
export const apiAdminDiscountPath = (id: string) =>
  `${API_PATHS.ADMIN_DISCOUNTS}/${encodeURIComponent(id)}`;

/** `/api/admin/provinces/{id}` — the OpenAPI template for the province toggle. */
export const API_ADMIN_PROVINCE_TEMPLATE = `${API_PATHS.ADMIN_PROVINCES}/{id}`;

/** The admin activate/deactivate path for one province, by id. */
export const apiAdminProvincePath = (id: number) =>
  `${API_PATHS.ADMIN_PROVINCES}/${id}`;

/** `/api/admin/content/{key}` — the OpenAPI template for the content block update. */
export const API_ADMIN_CONTENT_TEMPLATE = `${API_PATHS.ADMIN_CONTENT}/{key}`;

/** The content-block update path for one block, by key. */
export const apiAdminContentPath = (key: string) =>
  `${API_PATHS.ADMIN_CONTENT}/${encodeURIComponent(key)}`;

/** `/api/shipping/rates/{provinceId}` — the OpenAPI template for the admin update. */
export const API_SHIPPING_RATE_TEMPLATE = `${API_PATHS.SHIPPING_RATES}/{provinceId}`;

/** The admin rate-update path for one province. */
export const apiShippingRatePath = (provinceId: number) =>
  `${API_PATHS.SHIPPING_RATES}/${provinceId}`;

/** `/api/products/{slug}` — the OpenAPI template, as it appears in the doc. */
export const API_PRODUCT_DETAIL_TEMPLATE = `${API_PATHS.PRODUCTS}/{slug}`;

/** `/api/admin/products/{id}` — the OpenAPI template for the admin update/delete. */
export const API_ADMIN_PRODUCT_TEMPLATE = `${API_PATHS.ADMIN_PRODUCTS}/{id}`;

/** The admin update/delete path for one product, by id. */
export const apiAdminProductPath = (id: string) =>
  `${API_PATHS.ADMIN_PRODUCTS}/${encodeURIComponent(id)}`;

/** `/api/admin/products/{id}/images` — the OpenAPI template for image upload. */
export const API_ADMIN_PRODUCT_IMAGES_TEMPLATE = `${API_PATHS.ADMIN_PRODUCTS}/{id}/images`;

/** The image-upload path for one product, by id. */
export const apiAdminProductImagesPath = (id: string) =>
  `${API_PATHS.ADMIN_PRODUCTS}/${encodeURIComponent(id)}/images`;

/** The storefront's product detail path for one product. */
export const apiProductPath = (slug: string) =>
  `${API_PATHS.PRODUCTS}/${encodeURIComponent(slug)}`;

/** `/api/me/pets/{id}` — the OpenAPI template for the owner-scoped pet routes. */
export const API_ME_PET_TEMPLATE = `${API_PATHS.ME_PETS}/{id}`;

/** One of the caller's pets, by id (owner-scoped server-side). */
export const apiMePetPath = (id: string) =>
  `${API_PATHS.ME_PETS}/${encodeURIComponent(id)}`;

/** `/api/me/addresses/{id}` — the OpenAPI template for the owner-scoped address routes. */
export const API_ME_ADDRESS_TEMPLATE = `${API_PATHS.ME_ADDRESSES}/{id}`;

/** One of the caller's addresses, by id (owner-scoped server-side). */
export const apiMeAddressPath = (id: string) =>
  `${API_PATHS.ME_ADDRESSES}/${encodeURIComponent(id)}`;

/** The storefront's account order-detail page for one order. */
export const accountOrderPath = (id: string) =>
  `${PATHS.ACCOUNT}/orders/${encodeURIComponent(id)}`;
