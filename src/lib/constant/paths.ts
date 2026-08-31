// Route paths — never hardcode route strings in components or handlers;
// import from here so renames stay one-line changes.

export const PATHS = {
  HOME: '/',
  SHOP: '/shop',
  ABOUT: '/about',
  ACCOUNT: '/account',
  CHECKOUT: '/checkout',
} as const;

export const AUTH_PATHS = {
  SIGNIN: '/auth/signin',
  MAGIC: '/auth/magic',
} as const;

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
